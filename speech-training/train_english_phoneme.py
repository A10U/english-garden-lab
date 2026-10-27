"""Fine-tune the local English phoneme recognizer on prepared LibriSpeech.

This trains acoustic CTC recognition, not Qwen text-to-speech and not a
calibrated pronunciation grade. Canonical text-derived phone labels are not
human annotations of what a speaker actually pronounced. Nothing is deployed.

Default Apple Silicon recipe: batch size 1, accumulate 8, train the final two
encoder layers and CTC head; retain the other pretrained weights unchanged.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import random
import signal
import sys
import time
from typing import Any


SPLITS = ("train", "validation", "test")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n")
    temporary.replace(path)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def edit_distance(expected: list, observed: list) -> int:
    row = list(range(len(observed) + 1))
    for i, token in enumerate(expected, 1):
        next_row = [i]
        for j, heard in enumerate(observed, 1):
            next_row.append(min(next_row[-1] + 1, row[j] + 1, row[j - 1] + (token != heard)))
        row = next_row
    return row[-1]


def collapse_ctc(ids: list[int], blank: int) -> list[int]:
    result, previous = [], None
    for token in ids:
        if token != previous and token != blank:
            result.append(token)
        previous = token
    return result


def epoch_order(count: int, seed: int, epoch: int) -> list[int]:
    order = list(range(count))
    random.Random(seed + epoch).shuffle(order)
    return order


def lr_multiplier(step: int, warmup: int, total: int) -> float:
    if warmup and step < warmup:
        return (step + 1) / warmup
    return max(0.0, (total - step) / max(1, total - warmup))


def safe_audio_path(data: Path, value: str) -> Path:
    if not isinstance(value, str) or not value or Path(value).is_absolute():
        raise ValueError("Manifest audio paths must be relative to the dataset root")
    path = (data / value).resolve()
    if not path.is_relative_to(data.resolve()):
        raise ValueError("Manifest audio escaped the dataset root")
    if not path.is_file():
        raise ValueError(f"Missing training audio: {value}")
    return path


def load_splits(data: Path, vocabulary: dict[str, int], max_duration: float) -> tuple[dict, dict, dict]:
    """Validate all partitions before training; return usable rows and exclusions."""
    data = data.resolve()
    splits, statistics, fingerprints = {}, {}, {}
    owners: dict[str, dict[str, str]] = {key: {} for key in ("speaker", "audio", "id", "hash")}
    inverse = {value: key for key, value in vocabulary.items()}
    if len(inverse) != len(vocabulary):
        raise ValueError("Vocabulary IDs must be unique")
    for split in SPLITS:
        manifest = data / f"{split}.jsonl"
        fingerprints[split] = sha256_file(manifest)
        rows, skipped, total_seconds, kept_seconds = [], 0, 0.0, 0.0
        for number, line in enumerate(manifest.read_text().splitlines(), 1):
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("split") != split:
                raise ValueError(f"Wrong split in {split}.jsonl:{number}")
            if row.get("label_kind") != "canonical_text_reference" or row.get("human_reviewed") is not False:
                raise ValueError("Expected explicitly unreviewed canonical phone references")
            if row.get("label_source") != "canonical_espeak":
                raise ValueError("Unsupported or missing canonical phone label source")
            if not isinstance(row.get("text"), str) or not row["text"].strip():
                raise ValueError("Missing reference transcript")
            phones, ids = row.get("phones"), row.get("phone_ids")
            if not isinstance(phones, list) or not phones or not isinstance(ids, list) or len(ids) != len(phones):
                raise ValueError("Expected nonempty corresponding phones and phone_ids")
            if any(not isinstance(token, int) or isinstance(token, bool) or token == 0 or inverse.get(token) != phone
                   for token, phone in zip(ids, phones)):
                raise ValueError("Canonical labels do not match the local model vocabulary")
            duration = row.get("duration_seconds")
            if not isinstance(duration, (int, float)) or isinstance(duration, bool) or not math.isfinite(duration) or duration < 0.3:
                raise ValueError("Expected a finite duration of at least 0.3 seconds")
            if row.get("sample_rate_hz") != 16000:
                raise ValueError("Prepared training audio must be 16 kHz")
            audio = safe_audio_path(data, row.get("audio"))
            identity = {"speaker": str(row.get("speaker_id", "")), "audio": str(audio), "id": str(row.get("id", ""))}
            if not identity["speaker"] or not identity["id"]:
                raise ValueError("Missing speaker or utterance ID")
            if row.get("audio_sha256"):
                identity["hash"] = row["audio_sha256"]
            for key, value in identity.items():
                previous = owners[key].get(value)
                if previous is not None and (previous != split or key in ("audio", "id", "hash")):
                    raise ValueError(f"Dataset overlap or duplicate {key}: {value}")
                owners[key][value] = split
            total_seconds += duration
            if duration > max_duration:
                skipped += 1
                continue
            # CTC needs at least one additional frame for adjacent repeated IDs.
            minimum_frames = len(ids) + sum(a == b for a, b in zip(ids, ids[1:]))
            estimated_frames = max(0, (round(duration * 16000) - 400) // 320 + 1)
            if minimum_frames > estimated_frames:
                raise ValueError(f"Phone labels cannot fit the audio's CTC frames: {row['id']}")
            rows.append({**row, "resolved_audio": str(audio)})
            kept_seconds += duration
        if not rows:
            raise ValueError(f"No usable examples in {split}")
        splits[split] = rows
        statistics[split] = {"utterances": len(rows), "included_hours": kept_seconds / 3600,
                             "excluded_long_utterances": skipped, "manifest_hours": total_seconds / 3600}
    return splits, statistics, fingerprints


def select_evaluation(rows: list[dict], limit: int, seed: int) -> list[dict]:
    if limit <= 0 or limit >= len(rows):
        return rows
    return [rows[index] for index in sorted(epoch_order(len(rows), seed, 0)[:limit])]


def validate_output(model: Path, data: Path, output: Path) -> None:
    for protected in (model.resolve(), data.resolve()):
        if output.resolve().is_relative_to(protected) or protected.is_relative_to(output.resolve()):
            raise ValueError("Run output must be separate from the base model and dataset directories")


def configure_trainable(model, layers: int) -> dict:
    depth = len(model.wav2vec2.encoder.layers)
    if not 0 <= layers <= depth:
        raise ValueError(f"train-layers must be between 0 and {depth}")
    prefixes = tuple(f"wav2vec2.encoder.layers.{index}." for index in range(depth - layers, depth)) + ("lm_head.",)
    total = trainable = 0
    for name, parameter in model.named_parameters():
        parameter.requires_grad_(name.startswith(prefixes))
        total += parameter.numel()
        if parameter.requires_grad:
            trainable += parameter.numel()
    return {"total_parameters": total, "trainable_parameters": trainable,
            "trainable_encoder_layers": layers, "frozen_encoder_layers": depth - layers}


def training_mode(model, layers: int) -> None:
    # Frozen prefix stays deterministic: no layerdrop/spec-augment or dropout.
    model.eval()
    if layers:
        for layer in model.wav2vec2.encoder.layers[-layers:]:
            layer.train()
    model.lm_head.train()


def main(argv: list[str] | None = None) -> int:
    base = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=base / "models/phoneme-ctc")
    parser.add_argument("--data", type=Path, default=base / "data/english-phoneme-librispeech")
    parser.add_argument("--output", type=Path, default=base / "runs/english-phoneme-librispeech100-v1")
    parser.add_argument("--device", choices=("mps", "cpu"), default="mps")
    parser.add_argument("--epochs", type=int, default=1)
    parser.add_argument("--accumulate", type=int, default=8)
    parser.add_argument("--train-layers", type=int, default=2)
    parser.add_argument("--learning-rate", type=float, default=1e-5)
    parser.add_argument("--warmup-steps", type=int, default=100)
    parser.add_argument("--max-duration", type=float, default=35.0)
    parser.add_argument("--eval-every", type=int, default=250)
    parser.add_argument("--checkpoint-every", type=int, default=25)
    parser.add_argument("--eval-max-utterances", type=int, default=256,
                        help="Fixed validation subset; 0 evaluates the entire validation split")
    parser.add_argument("--test-max-utterances", type=int, default=0,
                        help="Final independent test limit; 0 evaluates the entire test split")
    parser.add_argument("--max-steps", type=int, default=0,
                        help="Explicit short/smoke run only; 0 processes all epochs")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--seed", type=int, default=3407)
    args = parser.parse_args(argv)
    if min(args.epochs, args.accumulate, args.eval_every, args.checkpoint_every) < 1 or args.train_layers < 0:
        parser.error("epochs, accumulate and check intervals must be positive; train-layers cannot be negative")
    if (not math.isfinite(args.learning_rate) or args.learning_rate <= 0
            or not math.isfinite(args.max_duration) or args.max_duration < 0.3
            or min(args.warmup_steps, args.max_steps, args.eval_max_utterances, args.test_max_utterances) < 0):
        parser.error("Invalid learning rate, duration or step/evaluation limit")
    args.model, args.data, args.output = (path.resolve() for path in (args.model, args.data, args.output))
    validate_output(args.model, args.data, args.output)
    args.output.mkdir(parents=True, exist_ok=True)
    checkpoint_path = args.output / "checkpoint.pt"
    if not args.resume and any(args.output.iterdir()):
        raise ValueError("Choose a fresh output directory or use --resume")
    if args.resume and not checkpoint_path.is_file():
        raise ValueError("--resume requires an existing completed-step checkpoint")
    started = time.time()
    status_path = args.output / "status.json"
    state = {"status": "preparing", "optimizer_step": 0, "epoch": 0, "cursor": 0,
             "scope": "English acoustic CTC fine-tuning; no calibrated pronunciation grade; no deployment",
             "short_run": bool(args.max_steps)}
    def status(**updates):
        state.update(updates)
        state["updated_at_unix"] = time.time()
        state["process_id"] = os.getpid()
        write_json(status_path, state)
    status()
    try:
        os.environ["HF_HUB_OFFLINE"] = "1"
        import numpy as np
        import soundfile as sf
        import torch
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC
        if args.device == "mps" and not torch.backends.mps.is_available():
            raise RuntimeError("MPS is unavailable; select --device cpu explicitly if CPU training is intended")
        random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed)
        if args.device == "mps":
            torch.mps.manual_seed(args.seed)
        vocabulary = json.loads((args.model / "vocab.json").read_text())
        splits, statistics, manifest_hashes = load_splits(args.data, vocabulary, args.max_duration)
        validation = select_evaluation(splits["validation"], args.eval_max_utterances, args.seed)
        test = select_evaluation(splits["test"], args.test_max_utterances, args.seed)
        base_weights = args.model / "pytorch_model.bin"
        if not base_weights.is_file():
            base_weights = args.model / "model.safetensors"
        source = {"weights_sha256": sha256_file(base_weights), "vocab_sha256": sha256_file(args.model / "vocab.json"),
                  "config_sha256": sha256_file(args.model / "config.json")}
        dataset_info_path = args.data / "dataset-info.json"
        if dataset_info_path.is_file():
            dataset_info = json.loads(dataset_info_path.read_text())
            if dataset_info.get("vocabulary_sha256") not in (None, source["vocab_sha256"]):
                raise ValueError("Dataset was prepared for a different phoneme vocabulary")
            for split in SPLITS:
                declared = dataset_info.get("splits", {}).get(split, {}).get("manifest_sha256")
                if declared and declared != manifest_hashes[split]:
                    raise ValueError(f"Prepared {split} manifest has changed since dataset verification")
        settings = {key: str(value) if isinstance(value, Path) else value for key, value in vars(args).items() if key != "resume"}
        recipe = {"source": source, "manifest_sha256": manifest_hashes, "settings": settings}
        extractor = Wav2Vec2FeatureExtractor.from_pretrained(args.model, local_files_only=True)
        model = Wav2Vec2ForCTC.from_pretrained(args.model, local_files_only=True)
        counts = configure_trainable(model, args.train_layers)
        model.config.apply_spec_augment = False
        model.to(device=args.device, dtype=torch.float32)
        blank = model.config.pad_token_id
        if blank != 0:
            raise ValueError("Prepared phoneme labels expect blank token 0")
        trainable = {name: parameter for name, parameter in model.named_parameters() if parameter.requires_grad}
        initial = {name: parameter.detach().cpu().clone() for name, parameter in trainable.items()}
        steps_per_epoch = math.ceil(len(splits["train"]) / args.accumulate)
        planned_steps = args.epochs * steps_per_epoch
        total_steps = min(planned_steps, args.max_steps) if args.max_steps else planned_steps
        optimizer = torch.optim.AdamW(trainable.values(), lr=args.learning_rate, weight_decay=0.01)
        warmup = min(args.warmup_steps, max(0, total_steps - 1))
        scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, lambda step: lr_multiplier(step, warmup, total_steps))
        run_config = {**recipe, "method": "Final encoder layers and CTC head; frozen deterministic prefix; float32",
                      **counts, "dataset": statistics, "planned_optimizer_steps": planned_steps,
                      "run_optimizer_steps": total_steps, "validation_utterances": len(validation), "test_utterances": len(test),
                      "label_limitation": "Canonical eSpeak labels from transcripts, not human observed-phone annotations",
                      "torch_version": torch.__version__, "python_version": sys.version.split()[0]}
        write_json(args.output / "run-config.json", run_config)
        print(json.dumps({"event": "configured", **counts, "dataset": statistics,
                          "steps": total_steps, "device": args.device}), flush=True)

        def load_audio(record):
            audio, rate = sf.read(record["resolved_audio"], dtype="float32", always_2d=False)
            if rate != 16000 or audio.ndim != 1 or not len(audio) or not np.isfinite(audio).all():
                raise ValueError(f"Expected finite mono 16 kHz audio: {record['id']}")
            if abs(len(audio) / rate - record["duration_seconds"]) > 0.01:
                raise ValueError(f"Audio duration changed after manifest creation: {record['id']}")
            return extractor(audio, sampling_rate=16000, return_tensors="pt").to(args.device)

        def evaluate(records, label):
            model.eval()
            edits = reference_tokens = 0
            with torch.inference_mode():
                for index, record in enumerate(records):
                    logits = model(**load_audio(record)).logits
                    if not torch.isfinite(logits).all().item():
                        raise RuntimeError("Model produced nonfinite evaluation logits")
                    observed = collapse_ctc(logits.argmax(-1)[0].cpu().tolist(), blank)
                    edits += edit_distance(record["phone_ids"], observed)
                    reference_tokens += len(record["phone_ids"])
                    if index % 25 == 0 or index + 1 == len(records):
                        status(phase=label, evaluation_done=index + 1, evaluation_total=len(records))
            result = {"phone_error_rate": edits / reference_tokens, "phone_edits": edits,
                      "reference_phones": reference_tokens, "utterances": len(records),
                      "canonical_label_metric": True, "calibrated_pronunciation_grade": False}
            print(json.dumps({"event": label, **result}), flush=True)
            return result

        def adapter_state():
            return {name: parameter.detach().cpu().clone() for name, parameter in trainable.items()}

        def restore_adapter(values):
            if set(values) != set(trainable):
                raise ValueError("Checkpoint trainable parameter set does not match this recipe")
            with torch.no_grad():
                for name, parameter in trainable.items():
                    parameter.copy_(values[name].to(args.device))

        def rng_state():
            result = {"python": random.getstate(), "numpy": np.random.get_state(), "torch": torch.get_rng_state()}
            if args.device == "mps":
                result["mps"] = torch.mps.get_rng_state()
            return result

        progress = {"step": 0, "epoch": 0, "cursor": 0, "best_per": None, "best_step": 0, "processed_audio_seconds": 0.0}
        baseline = best_metrics = None
        def save_checkpoint():
            temporary = checkpoint_path.with_suffix(".tmp")
            torch.save({"format_version": 1, "recipe": recipe, "adapter": adapter_state(),
                        "optimizer": optimizer.state_dict(), "scheduler": scheduler.state_dict(), "rng": rng_state(),
                        "progress": progress, "baseline": baseline, "best_metrics": best_metrics}, temporary)
            temporary.replace(checkpoint_path)

        if args.resume:
            saved = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
            if saved.get("format_version") != 1 or saved["recipe"] != recipe:
                raise ValueError("Resume requires the same base weights, manifests and training settings")
            restore_adapter(saved["adapter"]); optimizer.load_state_dict(saved["optimizer"]); scheduler.load_state_dict(saved["scheduler"])
            progress = saved["progress"]; baseline = saved["baseline"]; best_metrics = saved["best_metrics"]
            random.setstate(saved["rng"]["python"]); np.random.set_state(saved["rng"]["numpy"]); torch.set_rng_state(saved["rng"]["torch"])
            if args.device == "mps":
                torch.mps.set_rng_state(saved["rng"]["mps"])
        else:
            # A stop during baseline evaluation can restart from this initial
            # checkpoint rather than leaving an unusable occupied run folder.
            torch.save(initial, args.output / "best-adapter.pt")
            save_checkpoint()
        if baseline is None:
            status(status="evaluating", phase="baseline_validation")
            baseline = evaluate(validation, "baseline_validation")
            best_metrics = baseline; progress["best_per"] = baseline["phone_error_rate"]
            save_checkpoint()
        progress.setdefault("processed_audio_seconds", 0.0)

        stop_requested = False
        def stop_signal(_number, _frame):
            nonlocal stop_requested
            stop_requested = True
        signal.signal(signal.SIGINT, stop_signal); signal.signal(signal.SIGTERM, stop_signal)
        optimizer.zero_grad(set_to_none=True)
        training_started = time.time()
        completed_this_process = 0
        with (args.output / "metrics.jsonl").open("a") as metrics_log:
            while progress["epoch"] < args.epochs and progress["step"] < total_steps and not stop_requested:
                order = epoch_order(len(splits["train"]), args.seed, progress["epoch"])
                group = order[progress["cursor"]:progress["cursor"] + args.accumulate]
                training_mode(model, args.train_layers)
                group_loss = 0.0
                for index in group:
                    record = splits["train"][index]
                    logits = model(**load_audio(record)).logits.float()
                    targets = torch.tensor(record["phone_ids"], dtype=torch.long, device=args.device)
                    if not torch.isfinite(logits).all().item():
                        raise RuntimeError("Model produced nonfinite training logits")
                    loss = torch.nn.functional.ctc_loss(logits.log_softmax(-1).transpose(0, 1), targets,
                        torch.tensor([logits.shape[1]], dtype=torch.long), torch.tensor([len(targets)], dtype=torch.long),
                        blank=blank, reduction="sum", zero_infinity=False) / len(targets)
                    if not torch.isfinite(loss).item():
                        raise RuntimeError(f"Nonfinite CTC loss for {record['id']}; checkpoint remains at the last completed step")
                    group_loss += loss.item() / len(group)
                    (loss / len(group)).backward()
                gradient_norm = torch.nn.utils.clip_grad_norm_(trainable.values(), 1.0)
                if not torch.isfinite(gradient_norm).item():
                    raise RuntimeError("Nonfinite gradients; no optimizer update was applied")
                optimizer.step(); scheduler.step(); optimizer.zero_grad(set_to_none=True)
                progress["step"] += 1; progress["cursor"] += len(group); completed_this_process += 1
                progress["processed_audio_seconds"] += sum(splits["train"][index]["duration_seconds"] for index in group)
                if progress["cursor"] >= len(order):
                    progress["epoch"] += 1; progress["cursor"] = 0
                metric = {"event": "train", **progress, "loss": group_loss, "learning_rate": scheduler.get_last_lr()[0],
                          "seconds_per_optimizer_step": (time.time() - training_started) / completed_this_process}
                if args.device == "mps":
                    metric["mps_allocated_bytes"] = torch.mps.current_allocated_memory()
                    metric["mps_driver_allocated_bytes"] = torch.mps.driver_allocated_memory()
                metrics_log.write(json.dumps(metric, allow_nan=False) + "\n"); metrics_log.flush()
                print(json.dumps(metric), flush=True)
                status(status="training", phase="training", optimizer_step=progress["step"], epoch=progress["epoch"],
                       cursor=progress["cursor"], total_optimizer_steps=total_steps,
                       processed_audio_hours=progress["processed_audio_seconds"] / 3600,
                       elapsed_seconds=time.time() - started, latest_train=metric)
                if progress["step"] % args.eval_every == 0 or progress["step"] == total_steps:
                    current = evaluate(validation, "candidate_validation")
                    if current["phone_error_rate"] < progress["best_per"]:
                        progress["best_per"] = current["phone_error_rate"]; progress["best_step"] = progress["step"]
                        best_metrics = current; torch.save(adapter_state(), args.output / "best-adapter.pt")
                if progress["step"] % args.checkpoint_every == 0 or stop_requested:
                    save_checkpoint()
            save_checkpoint()
        if stop_requested:
            status(status="interrupted", phase="checkpoint_saved", optimizer_step=progress["step"], epoch=progress["epoch"], cursor=progress["cursor"])
            print("Interrupted at a completed optimizer step; rerun the identical command with --resume", flush=True)
            return 130
        # Test data is touched only after model selection using validation data.
        status(status="evaluating", phase="baseline_test")
        restore_adapter(initial)
        baseline_test = evaluate(test, "baseline_test")
        best = torch.load(args.output / "best-adapter.pt", map_location="cpu", weights_only=True)
        restore_adapter(best)
        candidate_test = evaluate(test, "candidate_test")
        status(status="exporting", phase="saving_candidate")
        candidate_dir = args.output / "candidate"
        model.to("cpu").save_pretrained(candidate_dir)
        extractor.save_pretrained(candidate_dir)
        for filename in ("vocab.json", "tokenizer_config.json", "special_tokens_map.json"):
            (candidate_dir / filename).write_bytes((args.model / filename).read_bytes())
        result = {"status": "short_run_complete" if args.max_steps else "complete", "optimizer_steps": progress["step"],
                  "best_step": progress["best_step"], "baseline_validation": baseline, "selected_validation": best_metrics,
                  "baseline_test": baseline_test, "candidate_test": candidate_test,
                  "candidate_improved_test_per": candidate_test["phone_error_rate"] < baseline_test["phone_error_rate"],
                  "trained_hours_available": statistics["train"]["included_hours"], "dataset": statistics,
                  "processed_audio_hours": progress["processed_audio_seconds"] / 3600,
                  "candidate_path": str(candidate_dir), "deployed": False,
                  "calibrated_pronunciation_grade": False, "elapsed_seconds": time.time() - started}
        write_json(args.output / "result.json", result)
        status(status=result["status"], phase="finished", result=result)
        print(json.dumps(result), flush=True)
        return 0
    except Exception as error:
        message = str(error)
        if "out of memory" in message.lower():
            message += "; MPS memory exhausted. Resume with the identical recipe after closing other heavy apps, or start a new run with --train-layers 0 / a smaller --max-duration. No automatic CPU retry was performed."
        status(status="failed", phase="error", error=message)
        print(message, file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
