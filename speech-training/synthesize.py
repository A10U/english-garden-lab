#!/usr/bin/env python3
"""Render seeded Qwen3-TTS baseline/LoRA samples without playing audio.

Run with the speech-training virtual environment. Models must already exist
locally; Hugging Face downloads are disabled for this command.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import random
import re
import time


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, required=True, help="Local Qwen3-TTS Base model directory")
    parser.add_argument("--adapter", type=Path, help="Directory containing adapter_config.json and adapters.safetensors")
    parser.add_argument("--ref-audio", type=Path, required=True)
    parser.add_argument("--ref-text", required=True, help="Reference transcript, or path to a UTF-8 transcript file")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--text", help="One short English utterance")
    source.add_argument("--prompts", type=Path, help="JSON list, or JSON object with a prompts list")
    parser.add_argument("--limit", type=int, default=3, help="Maximum prompt count (default: 3)")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--max-tokens", type=int, default=150, help="Maximum generated audio tokens per prompt (default: 150)")
    parser.add_argument("--seed", type=int, default=3407)
    parser.add_argument("--temperature", type=float, default=0.7)
    parser.add_argument("--top-k", type=int, default=50)
    parser.add_argument("--top-p", type=float, default=1.0)
    parser.add_argument("--repetition-penalty", type=float, default=1.5)
    parser.add_argument("--conditioning", choices=["speaker", "icl"], default="speaker",
        help="speaker matches this project's LoRA training prefix; icl also prepends reference text/audio codes")
    args = parser.parse_args()
    if args.limit < 1 or not 1 <= args.max_tokens <= 2048:
        parser.error("--limit must be positive and --max-tokens must be between 1 and 2048")
    if args.temperature < 0 or args.top_k < 1 or not 0 < args.top_p <= 1 or args.repetition_penalty <= 0:
        parser.error("Invalid sampling settings")
    for path in (args.model, args.ref_audio, args.adapter, args.prompts):
        if path is not None and not path.exists():
            parser.error(f"Local path does not exist: {path}")
    if not args.model.is_dir():
        parser.error("--model must be a local directory")
    return args


def read_prompts(args: argparse.Namespace) -> list[dict]:
    if args.text is not None:
        prompts = [{"id": "custom", "text": args.text}]
    else:
        data = json.loads(args.prompts.read_text(encoding="utf-8"))
        prompts = data.get("prompts") if isinstance(data, dict) else data
    if not isinstance(prompts, list) or not prompts:
        raise ValueError("Prompts JSON must contain a nonempty list")
    selected = []
    used_names = set()
    for index, prompt in enumerate(prompts[: args.limit]):
        if isinstance(prompt, str):
            prompt = {"text": prompt}
        if not isinstance(prompt, dict) or not isinstance(prompt.get("text"), str) or not prompt["text"].strip():
            raise ValueError(f"Prompt {index + 1} has no nonempty text")
        prompt = dict(prompt)
        prompt["text"] = prompt["text"].strip()
        prompt.setdefault("id", f"prompt-{index + 1:03d}")
        name = re.sub(r"[^A-Za-z0-9._-]+", "-", str(prompt["id"])).strip(".-")[:100]
        name = name or f"prompt-{index + 1:03d}"
        if name in used_names:
            raise ValueError(f"Duplicate output name from prompt ID: {prompt['id']}")
        used_names.add(name)
        prompt["output_name"] = name
        selected.append(prompt)
    return selected


def load_adapter(wrapper, adapter_dir: Path, fast_tts_model) -> tuple[dict, dict]:
    """Restore and verify every LoRA tensor before native model generation."""
    import numpy as np
    from mlx.utils import tree_flatten
    from safetensors.numpy import load_file

    config = json.loads((adapter_dir / "adapter_config.json").read_text(encoding="utf-8"))
    declared_model = config.get("model_name")
    current_model = getattr(wrapper, "model_name", None)
    if not isinstance(declared_model, str) or not declared_model.strip() or not current_model:
        raise ValueError("Adapter must declare model_name to verify its local base model")
    # This command accepts local model directories. A different/missing source
    # cannot be safely inferred from a similar directory or repository name.
    try:
        declared_path = Path(declared_model).expanduser().resolve(strict=True)
        current_path = Path(current_model).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise ValueError("Cannot verify adapter base identity: model_name must resolve to the local base model directory") from exc
    if not declared_path.is_dir() or declared_path != current_path:
        raise ValueError(f"Adapter base model mismatch: declared {declared_path}, loaded {current_path}")

    weights_path = adapter_dir / "adapters.safetensors"
    file_digest = hashlib.sha256(weights_path.read_bytes()).hexdigest()
    saved = load_file(str(weights_path))
    if not saved or any("lora_" not in name for name in saved):
        raise ValueError("Adapter weights must contain a nonempty set of LoRA tensors only")
    lora = config.get("lora_parameters", {})
    rank = int(lora.get("rank", 0))
    if rank < 1:
        raise ValueError("Adapter configuration must declare a positive LoRA rank")
    fast_tts_model.get_peft_model(
        wrapper,
        r=rank,
        lora_alpha=int(lora.get("alpha", rank)),
        lora_dropout=float(lora.get("dropout", 0.0)),
        target_modules=lora.get("keys") or None,
    )
    wrapper.load_adapter(str(adapter_dir.resolve()))
    loaded = dict(tree_flatten(wrapper.model.trainable_parameters()))
    missing = sorted(set(saved) - set(loaded))
    extra = sorted(set(loaded) - set(saved))
    if missing or extra:
        raise ValueError(f"Adapter key mismatch: missing loaded keys={missing}, extra trainable keys={extra}")

    saved_digest = hashlib.sha256()
    loaded_digest = hashlib.sha256()
    tensor_count = 0
    parameter_count = 0
    for name in sorted(saved):
        expected = np.ascontiguousarray(saved[name])
        actual = np.ascontiguousarray(np.asarray(loaded[name]))
        if expected.dtype != actual.dtype:
            raise ValueError(f"Adapter dtype mismatch for {name}: saved {expected.dtype}, loaded {actual.dtype}")
        if expected.shape != actual.shape:
            raise ValueError(f"Adapter shape mismatch for {name}: saved {expected.shape}, loaded {actual.shape}")
        if not np.isfinite(expected).all() or not np.isfinite(actual).all():
            raise ValueError(f"Adapter contains nonfinite values: {name}")
        expected_bytes, actual_bytes = expected.tobytes(), actual.tobytes()
        if expected_bytes != actual_bytes:
            raise ValueError(f"Adapter data mismatch after loading: {name}")
        # Include tensor identity and layout, so the digest proves more than
        # a concatenation of values whose boundaries might be ambiguous.
        header = json.dumps([name, expected.dtype.str, list(expected.shape)], separators=(",", ":")).encode()
        for digest, values in ((saved_digest, expected_bytes), (loaded_digest, actual_bytes)):
            digest.update(len(header).to_bytes(8, "little"))
            digest.update(header)
            digest.update(len(values).to_bytes(8, "little"))
            digest.update(values)
        tensor_count += 1
        parameter_count += expected.size
    if hashlib.sha256(weights_path.read_bytes()).hexdigest() != file_digest:
        raise ValueError("Adapter weights changed on disk while loading")
    verification = {
        "verified": True,
        "base_identity_method": "Canonical local directory path equality; not a base-weight content hash",
        "declared_model_path": str(declared_path),
        "loaded_model_path": str(current_path),
        "weights_file_sha256": file_digest,
        "saved_tensors_sha256": saved_digest.hexdigest(),
        "loaded_tensors_sha256": loaded_digest.hexdigest(),
        "tensor_count": tensor_count,
        "parameter_count": int(parameter_count),
        "checks": ["exact key set", "dtype", "shape", "finite values", "byte-exact values", "file unchanged during load"],
    }
    print(f"Verified {tensor_count} LoRA tensors; loaded SHA256={verification['loaded_tensors_sha256']}", flush=True)
    return config, verification


def write_json(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def main() -> None:
    args = parse_args()
    prompts = read_prompts(args)
    transcript_path = Path(args.ref_text)
    try:
        is_transcript_file = transcript_path.is_file()
    except OSError:
        is_transcript_file = False
    ref_text = transcript_path.read_text(encoding="utf-8").strip() if is_transcript_file else args.ref_text.strip()
    if not ref_text:
        raise ValueError("Reference transcript must not be empty")

    # Set before importing loaders, including nested codec/tokenizer loaders.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_tune import FastTTSModel

    args.output_dir.mkdir(parents=True, exist_ok=True)
    started = time.perf_counter()
    wrapper, _ = FastTTSModel.from_pretrained(str(args.model.resolve()))
    adapter_config, adapter_verification = load_adapter(wrapper, args.adapter, FastTTSModel) if args.adapter else (None, None)
    FastTTSModel.for_inference(wrapper)
    native = wrapper.full_model
    if native is None or not callable(getattr(native, "generate", None)):
        raise TypeError("This model has no native Qwen3-TTS generator")
    model_type = getattr(native.config, "tts_model_type", "base")
    if model_type != "base":
        raise ValueError(f"Expected Qwen3-TTS Base; received {model_type!r}")
    native.eval()
    load_seconds = time.perf_counter() - started
    ref_info = sf.info(str(args.ref_audio))
    settings = {
        "lang_code": "english", "max_tokens": args.max_tokens,
        "temperature": args.temperature, "top_k": args.top_k,
        "top_p": args.top_p, "repetition_penalty": args.repetition_penalty,
        "stream": False, "split_pattern": "",
    }
    metadata = {
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
        "model": str(args.model.resolve()),
        "adapter": str(args.adapter.resolve()) if args.adapter else None,
        "adapter_config": adapter_config,
        "adapter_load_verification": adapter_verification,
        "reference_audio": str(args.ref_audio.resolve()),
        "reference_audio_sha256": hashlib.sha256(args.ref_audio.read_bytes()).hexdigest(),
        "reference_duration_seconds": ref_info.duration,
        "reference_text": ref_text,
        "prompts_source": str(args.prompts.resolve()) if args.prompts else None,
        "settings": settings, "base_seed": args.seed,
        "seed_protocol": "Reset Python, NumPy and MLX RNG to base_seed + prompt index before each utterance.",
        "conditioning": args.conditioning,
        "load_seconds": load_seconds, "results": [],
        "naturalness_evaluated": False,
    }
    metadata_path = args.output_dir / "metadata.json"
    write_json(metadata_path, metadata)

    for index, prompt in enumerate(prompts):
        seed = args.seed + index
        random.seed(seed)
        np.random.seed(seed % (2**32))
        mx.random.seed(seed)
        result_meta = {"id": prompt["id"], "text": prompt["text"], "seed": seed}
        tick = time.perf_counter()
        try:
            chunks, rates, token_counts = [], [], []
            for result in native.generate(
                text=prompt["text"], ref_audio=str(args.ref_audio.resolve()),
                ref_text=ref_text if args.conditioning == "icl" else None,
                verbose=False, **settings,
            ):
                mx.eval(result.audio)
                chunks.append(np.asarray(result.audio, dtype=np.float32).reshape(-1))
                rates.append(int(result.sample_rate))
                token_counts.append(int(result.token_count))
            elapsed = time.perf_counter() - tick
            if not chunks or any(rate != rates[0] for rate in rates):
                raise ValueError("Generator returned no audio or inconsistent sample rates")
            audio = np.concatenate(chunks)
            nonfinite = int(np.count_nonzero(~np.isfinite(audio)))
            result_meta.update({
                "generation_seconds": elapsed, "sample_rate": rates[0],
                "samples": int(audio.size), "duration_seconds": float(audio.size / rates[0]),
                "nonfinite_samples": nonfinite, "segment_token_counts": token_counts,
                "may_be_truncated": any(count >= args.max_tokens for count in token_counts),
            })
            if nonfinite or not audio.size:
                raise ValueError("Refusing to write empty or nonfinite generated audio")
            peak = float(np.max(np.abs(audio)))
            output = args.output_dir / f"{prompt['output_name']}.wav"
            # FLOAT WAV preserves the actual waveform, including peaks above 1.
            sf.write(str(output), audio, rates[0], subtype="FLOAT")
            result_meta.update({
                "status": "ok", "file": output.name, "peak_absolute_amplitude": peak,
                "samples_above_unit_amplitude": int(np.count_nonzero(np.abs(audio) > 1)),
                "real_time_factor": elapsed / (audio.size / rates[0]),
            })
            print(f"{output.name}: {audio.size / rates[0]:.2f}s audio in {elapsed:.2f}s, peak={peak:.4f}", flush=True)
        except Exception as exc:
            result_meta.update({"status": "error", "error": f"{type(exc).__name__}: {exc}", "generation_seconds": time.perf_counter() - tick})
            metadata["results"].append(result_meta)
            write_json(metadata_path, metadata)
            raise
        metadata["results"].append(result_meta)
        write_json(args.output_dir / f"{prompt['output_name']}.json", result_meta)
        write_json(metadata_path, metadata)
        mx.clear_cache()


if __name__ == "__main__":
    main()
