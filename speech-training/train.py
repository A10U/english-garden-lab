"""Local Qwen3-TTS talker LoRA training on Apple Silicon.

Only attention adapters are optimized. The pretrained speech tokenizer,
speaker encoder, embeddings, and residual code predictor remain frozen.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np
import soundfile as sf
from mlx.utils import tree_flatten, tree_map
from mlx_tune import FastTTSModel

from qwen_conditioning import QwenBaseCollator


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def parameter_digest(model):
    digest = hashlib.sha256()
    for name, array in tree_flatten(model.trainable_parameters()):
        digest.update(name.encode())
        digest.update(np.asarray(array).tobytes())
    return digest.hexdigest()


def prepare_codes(wrapper, data_root, output, source_info):
    """Encode target audio once; never use the evaluation texts for training."""
    cache = data_root / "qwen_codes"
    cache.mkdir(exist_ok=True)
    source_key = hashlib.sha256(json.dumps(source_info, sort_keys=True).encode()).hexdigest()[:16]
    evaluation_path = Path(__file__).resolve().parent / "resources/evaluation-prompts.json"
    held_out_texts = {p["text"].strip().casefold() for p in json.loads(evaluation_path.read_text())["prompts"]}
    splits = {}
    for split in ["train", "valid", "test"]:
        records = read_jsonl(data_root / f"{split}.jsonl")
        processed = []
        for index, record in enumerate(records):
            if record["text"].strip().casefold() in held_out_texts:
                raise ValueError("A held-out audition prompt appeared in training data")
            wav_path = data_root / record["audio"]
            wav_hash = hashlib.sha256(wav_path.read_bytes()).hexdigest()
            encoded_path = cache / f"{record['id']}-{source_key}-{wav_hash[:12]}.npz"
            if not encoded_path.exists():
                audio, sr = sf.read(wav_path, dtype="float32")
                if sr != 24000 or audio.ndim != 1 or not np.isfinite(audio).all():
                    raise ValueError(f"Expected finite mono24kHz audio: {wav_path}")
                codes = wrapper.codec_adapter.encode_all_codebooks(audio, sr)
                mx.eval(codes)
                codes = np.asarray(codes).astype(np.int32)
                if codes.ndim != 2 or codes.shape[0] != 16:
                    raise ValueError(f"Unexpected codec layout: {codes.shape}")
                np.savez_compressed(encoded_path, codes=codes.T)
                mx.clear_cache()
            processed.append({**record, "codes_path": str(encoded_path.resolve())})
            if (index + 1) % 32 == 0 or index + 1 == len(records):
                print(f"Encoded {split}: {index + 1}/{len(records)}", flush=True)
        splits[split] = processed
    save_json(output / "encoded-data.json", {k: [{a: b for a, b in r.items() if a != 'audio_codes'} for r in v] for k, v in splits.items()})
    return splits


def load_sample(record):
    with np.load(record["codes_path"]) as archive:
        codes = archive["codes"].copy()
    return {"text": record["text"], "audio_codes": codes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=Path(__file__).parent / "models/qwen3-tts-0.6b-base-8bit")
    parser.add_argument("--data", type=Path, default=Path(__file__).parent / "data")
    parser.add_argument("--output", type=Path, default=Path(__file__).parent / "runs/qwen3-hifi92-lora-v1")
    parser.add_argument("--steps", type=int, default=200)
    parser.add_argument("--accumulate", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--rank", type=int, default=8)
    parser.add_argument("--eval-every", type=int, default=25)
    parser.add_argument("--seed", type=int, default=3407)
    args = parser.parse_args()
    if min(args.steps, args.accumulate, args.rank, args.eval_every) < 1:
        parser.error("steps, accumulate, rank and eval-every must be positive")
    args.model = args.model.resolve()
    args.data = args.data.resolve()
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=True)
    if (args.output / "result.json").exists():
        parser.error("Output already contains a completed run; choose a fresh --output directory")
    mx.random.seed(args.seed)
    np.random.seed(args.seed)
    rng = random.Random(args.seed)
    started = time.time()
    source_path = Path(__file__).parent / "model-source.json"
    source_info = json.loads(source_path.read_text())
    dataset_info = json.loads((args.data / "dataset-info.json").read_text())
    save_json(args.output / "run-config.json", {
        "status": "preparing", "model_source": source_info, "dataset": dataset_info,
        "settings": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
        "method": "LoRA on talker attention q_proj/v_proj; other pretrained weights frozen",
        "conditioning": "Canonical installed mlx-audio Base prefix with English language and a fixed training-voice speaker embedding",
        "scope": "Initial voice adaptation experiment; conversational naturalness is not established by training loss."
    })
    wrapper, tokenizer = FastTTSModel.from_pretrained(str(args.model), max_seq_length=512)
    wrapper.full_model.eval()
    reference = dataset_info["reference"]
    ref_audio, ref_sr = sf.read(args.data / reference["audio"], dtype="float32")
    if ref_sr != 24000:
        raise ValueError("Reference must be 24kHz")
    speaker_embedding = wrapper.full_model.extract_speaker_embedding(mx.array(ref_audio))
    mx.eval(speaker_embedding)
    np.save(args.output / "speaker_embedding.npy", np.asarray(speaker_embedding.astype(mx.float32)))
    splits = prepare_codes(wrapper, args.data, args.output, source_info)
    wrapper = FastTTSModel.get_peft_model(wrapper, r=args.rank, lora_alpha=args.rank,
        target_modules=["q_proj", "v_proj"], use_gradient_checkpointing=False,
        random_state=args.seed)
    wrapper._apply_lora()
    model = wrapper.model
    trainable = tree_flatten(model.trainable_parameters())
    if not trainable or any("lora_" not in key for key, _ in trainable):
        raise RuntimeError("Expected only LoRA weights to be trainable")
    n_trainable = sum(array.size for _, array in trainable)
    initial_digest = parameter_digest(model)
    wrapper.save_pretrained(str(args.output / "initial_adapter"))
    collator = QwenBaseCollator(wrapper, speaker_embedding=speaker_embedding,
        language="English", max_seq_length=512)

    def loss_fn(current_model, batch):
        result = current_model(batch["inputs_embeds"])
        logits = result[0] if isinstance(result, tuple) else result
        logits = logits[:, :-1].astype(mx.float32)
        labels = batch["labels"][:, 1:]
        mask = labels != -100
        safe_labels = mx.where(mask, labels, mx.zeros_like(labels))
        token_losses = nn.losses.cross_entropy(logits, safe_labels, reduction="none")
        return (token_losses * mask).sum() / mx.maximum(mask.sum(), 1)

    def evaluate(records):
        model.eval()
        total_loss, total_tokens = 0.0, 0
        for record in records:
            batch = collator([load_sample(record)])
            loss = loss_fn(model, batch)
            mx.eval(loss)
            count = int(mx.sum(batch["labels"][:, 1:] != -100).item())
            total_loss += float(loss.item()) * count
            total_tokens += count
        mx.clear_cache()
        return total_loss / max(total_tokens, 1)

    valid_before = evaluate(splits["valid"])
    print(f"Baseline held-out validation CE: {valid_before:.6f}", flush=True)
    print(f"Trainable LoRA parameters: {n_trainable:,}", flush=True)
    optimizer = optim.AdamW(learning_rate=args.learning_rate, weight_decay=0.01)
    value_and_grad = nn.value_and_grad(model, loss_fn)
    best_loss, best_step = valid_before, 0
    order = list(range(len(splits["train"])))
    rng.shuffle(order)
    cursor, losses = 0, []
    metrics_path = args.output / "metrics.jsonl"
    with metrics_path.open("w") as log:
        log.write(json.dumps({"step": 0, "valid_loss": valid_before}) + "\n")
        log.flush()
        for step in range(1, args.steps + 1):
            model.train()
            accumulated, batch_losses = None, []
            for _ in range(args.accumulate):
                if cursor == len(order):
                    rng.shuffle(order)
                    cursor = 0
                record = splits["train"][order[cursor]]
                cursor += 1
                batch = collator([load_sample(record)])
                loss, grads = value_and_grad(model, batch)
                mx.eval(loss, grads)
                value = float(loss.item())
                if not math.isfinite(value):
                    raise RuntimeError(f"Nonfinite training loss at step{step}")
                batch_losses.append(value)
                accumulated = grads if accumulated is None else tree_map(lambda a, b: a + b, accumulated, grads)
            averaged = tree_map(lambda a: a / args.accumulate, accumulated)
            norm = mx.sqrt(sum(mx.sum(a.astype(mx.float32) ** 2) for _, a in tree_flatten(averaged)))
            mx.eval(norm)
            norm_value = float(norm.item())
            if not math.isfinite(norm_value):
                raise RuntimeError(f"Nonfinite gradients at step{step}")
            clipped = tree_map(lambda a: a / mx.maximum(norm, 1.0), averaged)
            warmup = min(10, max(1, args.steps // 10))
            lr = args.learning_rate * min(step / warmup, 1.0) * max(0.1, (args.steps - step + 1) / args.steps)
            optimizer.learning_rate = lr
            optimizer.update(model, clipped)
            mx.eval(model.parameters(), optimizer.state)
            train_loss = sum(batch_losses) / len(batch_losses)
            losses.append(train_loss)
            entry = {"step": step, "train_loss": train_loss, "learning_rate": lr,
                "gradient_norm": norm_value, "elapsed_seconds": time.time() - started,
                "peak_gpu_gb": mx.get_peak_memory() / 1e9}
            if step % args.eval_every == 0 or step == args.steps:
                entry["valid_loss"] = evaluate(splits["valid"])
                wrapper.save_pretrained(str(args.output / f"checkpoint-{step:04d}"))
                if entry["valid_loss"] < best_loss:
                    best_loss, best_step = entry["valid_loss"], step
                    wrapper.save_pretrained(str(args.output / "best_adapter"))
            log.write(json.dumps(entry) + "\n")
            log.flush()
            print(json.dumps(entry), flush=True)
            mx.clear_cache()
    wrapper.save_pretrained(str(args.output / "final_adapter"))
    final_digest = parameter_digest(model)
    if final_digest == initial_digest:
        raise RuntimeError("Training did not change adapter weights")
    test_final = evaluate(splits["test"])
    result = {
        "status": "training_completed", "optimizer_steps": args.steps,
        "micro_batches": args.steps * args.accumulate, "trainable_parameters": n_trainable,
        "validation_ce_before": valid_before, "validation_ce_best": best_loss,
        "best_step": best_step, "test_ce_final": test_final,
        "train_loss_mean": sum(losses) / len(losses),
        "adapter_sha256_before": initial_digest, "adapter_sha256_after": final_digest,
        "weights_changed": final_digest != initial_digest,
        "elapsed_seconds": time.time() - started, "peak_gpu_gb": mx.get_peak_memory() / 1e9,
        "naturalness_improved": None, "human_listening_evaluation": "pending",
        "app_integrated": False, "base_model_unchanged": True,
        "suggested_adapter": "best_adapter" if best_step else "initial_adapter",
        "note": "Held-out token loss measures acoustic-token prediction; it does not establish a naturalness improvement."
    }
    save_json(args.output / "result.json", result)
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
