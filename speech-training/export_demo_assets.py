#!/usr/bin/env python3
"""Export only curated, prerecorded AI demo assets; never read user recordings.

Run once in the authoring checkout:
    python3 speech-training/export_demo_assets.py

Public checkouts need only the exported files, app/ and speech-training/:
    python3 speech-training/export_demo_assets.py --verify

The exporter uses only Python's standard library. It performs no inference,
network requests or audio re-encoding. Original authoring metadata/analysis is
read from fixed allowlisted locations; private paths and model metadata never
enter the public JSON. Output bytes are deterministic for unchanged inputs.
"""
from __future__ import annotations

import argparse
from array import array
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import sys


SOURCE_SPECS = (
    ("baseline", "speech-training/runs/baseline-speaker/metadata.json", range(1, 25)),
    ("candidate", "speech-training/runs/qwen3-hifi92-lora-v1/samples/metadata.json", range(1, 25)),
    ("practice", "speech-training/runs/word-practice/metadata.json", range(101, 115)),
)
PUBLIC_PREFIX = "../speech-training/demo-assets/"
FORBIDDEN_MARKERS = ("/Users/", "/home/", "file://", "\\Users\\", "Resource/", "SDLC/",
                     "speech-training/runs/", ".venv/", "models/")
PRIVATE_KEYS = {"model", "model_name", "adapter", "reference_audio_sha256",
                "prompts_source", "source_metadata", "candidate_adapter", "baseline_adapter"}
ANALYSIS_KEYS = ("reference", "observed", "alignment", "metrics", "analysis_type", "audio_analyzed", "limitations")
ATTRIBUTION = """English Garden Lab — prerecorded AI speech demo

The demo WAV files are generated AI speech of original project-authored English
prompts. They are not user microphone recordings or copies of the source corpus.
The candidate voice was adapted using a bounded clean subset of speaker 92
(Cori Samuel) from the following dataset:

Hi-Fi Multi-Speaker English TTS Dataset (Hi-Fi TTS), 2021
Evelina Bakhturina, Vitaly Lavrukhin, Boris Ginsburg and Yang Zhang.
Official resource: https://www.openslr.org/109/
Paper: https://arxiv.org/abs/2104.01497
License: Creative Commons Attribution 4.0 International (CC BY 4.0)
License text: https://creativecommons.org/licenses/by/4.0/
Source corpus: public LibriVox audiobooks and Project Gutenberg texts.
Authoring modifications: selection of one speaker; bounded clean audio subset;
resampling to 24 kHz; model adaptation; synthesis of newly authored prompts.
No dataset source recordings or model weights are included in this export.

Text IPA was generated with phonemizer/eSpeak NG. Acoustic phone observations
were precomputed using Meta's wav2vec2 phoneme-recognition checkpoint (Apache 2.0).
These cached observations concern only the included generated AI recordings.
They do not analyze visitors' microphones and are not learner pronunciation grades.
Word times are approximate CTC-derived playback ranges, not expert alignments.
Naturalness improvement requires listening evaluation; it is not established by
an automatic transcript match, a phone comparison, or training loss alone.
"""


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path.name}")
    return value


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")


def assert_public(value: object, location: str = "public data") -> None:
    """Fail closed if cached analysis unexpectedly contains private paths/keys."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key in PRIVATE_KEYS or (key == "reference_audio" and not isinstance(item, dict)):
                raise ValueError(f"Private metadata key in {location}: {key}")
            assert_public(key, location)
            assert_public(item, location)
    elif isinstance(value, list):
        for item in value:
            assert_public(item, location)
    elif isinstance(value, str):
        if value.startswith(("/", "file:")) or any(marker in value for marker in FORBIDDEN_MARKERS):
            raise ValueError(f"Nonportable/private path in {location}")
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"Nonfinite number in {location}")


def wav_info(data: bytes) -> dict:
    """Inspect PCM/float RIFF WAV without a heavyweight audio dependency."""
    if len(data) < 44 or data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("Curated audio must be a complete RIFF WAV")
    if struct.unpack_from("<I", data, 4)[0] + 8 != len(data):
        raise ValueError("WAV RIFF length differs from actual bytes")
    fmt = pcm = None
    position = 12
    while position + 8 <= len(data):
        name, size = struct.unpack_from("<4sI", data, position)
        start, end = position + 8, position + 8 + size
        if end > len(data):
            raise ValueError("Truncated WAV chunk")
        if name == b"fmt ":
            if size < 16:
                raise ValueError("Invalid WAV format chunk")
            fmt = struct.unpack_from("<HHIIHH", data, start)
        elif name == b"data":
            pcm = data[start:end]
        position = end + size % 2
    if fmt is None or pcm is None:
        raise ValueError("WAV requires format and sample chunks")
    encoding, channels, rate, _byte_rate, block_align, bits = fmt
    if channels != 1 or rate != 24000 or (encoding, bits) not in {(1, 16), (3, 32)}:
        raise ValueError("Expected curated mono 24kHz PCM16 or float32 WAV")
    if not pcm or not block_align or len(pcm) % block_align:
        raise ValueError("WAV has missing/incomplete sample frames")
    samples = len(pcm) // block_align
    if encoding == 3:
        values = array("f")
        values.frombytes(pcm)
        if sys.byteorder != "little":
            values.byteswap()
        if not all(math.isfinite(value) for value in values):
            raise ValueError("WAV contains nonfinite samples")
    return {"samples": samples, "sample_rate": rate, "duration_seconds": samples / rate,
            "channels": channels, "bits_per_sample": bits}


def sanitized_reference(source: dict, *, url: str, text: str, audio_sha: str, duration: float) -> dict:
    if source.get("text") != text or source.get("audio_sha256") != audio_sha:
        raise ValueError("Reference text or audio SHA does not match curated recording")
    if abs(float(source.get("duration_seconds", -1)) - duration) > 1 / 16000:
        raise ValueError("Reference duration differs from WAV samples")
    words = []
    for index, item in enumerate(source.get("words", [])):
        if item.get("index") != index or not isinstance(item.get("text"), str):
            raise ValueError("Reference words have invalid indices/text")
        word = {key: item.get(key) for key in ("index", "text", "ipa", "start", "end", "core_start", "core_end")}
        start, end = word["start"], word["end"]
        if (start is None) != (end is None) or (start is not None and not 0 <= start < end <= duration):
            raise ValueError("Reference playback time lies outside actual recording")
        words.append(word)
    source_words = re.findall(r"[A-Za-z]+(?:['’][A-Za-z]+)*|\d+(?:[.,]\d+)*", text)
    if [word["text"] for word in words] != source_words:
        raise ValueError("Reference word indices do not cover the source text exactly")
    return {"text": text, "url": url, "audio_sha256": audio_sha,
            "duration_seconds": duration, "words": words,
            "timing": "Approximate acoustic CTC times; not expert word boundaries",
            "playback_source": "prerecorded_ai"}


def export_assets(project_root: Path, output: Path | None = None) -> dict:
    root = project_root.resolve()
    output = (output or root / "speech-training/demo-assets").resolve()
    engine_sha = digest((root / "speech-training/phonetic_engine.py").read_bytes())
    resources = root / "speech-training/resources"
    phonetics = load_json(resources / "phonetics.json")["texts"]
    reference_data = load_json(resources / "reference-audio.json")
    evaluation = load_json(resources / "evaluation-prompts.json")
    prompts = {item["id"]: item for item in evaluation["prompts"]}
    inventory, recordings, analyses, by_audio, by_text, sources = [], [], {}, {}, {}, {}
    audio_bytes = {}
    for variant, source_name, numbers in SOURCE_SPECS:
        metadata_path = root / source_name
        metadata = load_json(metadata_path)
        entries = metadata.get("results", [])
        expected_ids = {f"tts-{number:03d}" for number in numbers}
        if len(entries) != len(expected_ids) or {item.get("id") for item in entries} != expected_ids:
            raise ValueError(f"Unexpected curated recording inventory for {variant}")
        sources[variant] = {}
        for item in sorted(entries, key=lambda entry: entry["id"]):
            ident, text, filename = item["id"], item.get("text"), item.get("file")
            if item.get("status") != "ok" or item.get("may_be_truncated") or item.get("nonfinite_samples", 0):
                raise ValueError(f"Curated synthesis did not complete cleanly: {variant}/{ident}")
            if not isinstance(text, str) or not text or filename != ident + ".wav":
                raise ValueError("Curated recording filename/text is malformed")
            source_audio = (metadata_path.parent / filename).resolve()
            if source_audio.parent != metadata_path.parent.resolve():
                raise ValueError("Curated audio must stay beside its fixed source metadata")
            data = source_audio.read_bytes()
            info = wav_info(data)
            if info["samples"] != item.get("samples") or info["sample_rate"] != item.get("sample_rate"):
                raise ValueError(f"Audio dimensions differ from metadata: {variant}/{ident}")
            relative = f"audio/{variant}/{filename}"
            url, sha = PUBLIC_PREFIX + relative, digest(data)
            source_key = source_audio.relative_to(root).as_posix()
            source_reference = reference_data["by_audio"].get(url) or reference_data["by_audio"].get(source_key)
            if source_reference is None:
                raise ValueError("Missing curated recording reference in portable resources")
            reference = sanitized_reference(source_reference, url=url,
                text=text, audio_sha=sha, duration=info["duration_seconds"])
            cache_id = digest((engine_sha + sha + text).encode("utf-8"))
            cached = load_json(root / "speech-training/runs/reference-alignments" / (cache_id + ".json"))
            if cached.get("audio_analyzed") is not True or cached.get("reference", {}).get("text") != text:
                raise ValueError("Expected an actual cached analysis of this curated AI recording")
            if abs(cached.get("metrics", {}).get("duration_seconds", -1) - info["duration_seconds"]) > 1 / 16000:
                raise ValueError("Cached acoustic duration does not match WAV samples")
            analysis = {key: cached[key] for key in ANALYSIS_KEYS if key in cached}
            analysis.update({"precomputed": True, "live_analysis": False,
                "playback_source": "prerecorded_ai", "audio_url": url, "audio_sha256": sha,
                "demo_notice": "ผลที่คำนวณไว้จากเสียง AI ตัวอย่าง ไม่ใช่การตรวจเสียงผู้เข้าชมแบบสด"})
            record = {"id": ident, "text": text, "variant": variant,
                "label": {"baseline": "A", "candidate": "B", "practice": "ตัวอย่างฝึก"}[variant],
                "audio": url, **info, "audio_sha256": sha, "reference": reference,
                "seed": item.get("seed"), "may_be_truncated": False}
            generation = item.get("generation_seconds")
            if isinstance(generation, (float, int)) and math.isfinite(generation):
                record["generation_seconds"] = generation
            sources[variant][ident] = record
            recordings.append(record)
            analyses[url] = analysis
            by_audio[url] = reference
            by_text[text] = reference  # candidate/practice intentionally replace baseline.
            inventory.append({"path": relative, "sha256": sha, "bytes": len(data),
                              "id": ident, "variant": variant, "duration_seconds": info["duration_seconds"]})
            audio_bytes[relative] = data
    pairs = []
    for ident in sorted(sources["baseline"]):
        left, right = sources["baseline"][ident], sources["candidate"][ident]
        if left["text"] != right["text"] or left["seed"] != right["seed"]:
            raise ValueError("A/B recordings require matching prompts and seeds")
        prompt = prompts.get(ident, {})
        if prompt.get("text") != left["text"]:
            raise ValueError("A/B text differs from curated project prompt")
        pairs.append({"id": ident, "text": left["text"], "category": prompt.get("category", "practice"),
            "precomputed": phonetics[left["text"]], "baseline": left, "candidate": right})
    training_source = load_json(root / "speech-training/runs/qwen3-hifi92-lora-v1/result.json")
    training = {key: training_source.get(key) for key in (
        "status", "optimizer_steps", "trainable_parameters", "validation_ce_before",
        "validation_ce_best", "best_step", "weights_changed", "naturalness_improved", "human_listening_evaluation")}
    payload = {
        "schema_version": 1, "url_convention": "Relative to app/index.html or speech-training/listen.html; preserves hosted site prefix",
        "demo": {"prerecorded_only": True, "contains_user_recordings": False,
                 "live_analysis_available": False, "learner_grade": False,
                 "labels": {"baseline": "A", "candidate": "B"}},
        "pairs": pairs, "texts": phonetics, "recordings": recordings, "analyses": analyses,
        "reference_audio": {"by_audio": by_audio, "by_text": by_text}, "training": training,
        "inventory": sorted(inventory, key=lambda item: item["path"]),
        "attributions": [{"name": "Hi-Fi Multi-Speaker English TTS Dataset (Hi-Fi TTS)",
            "creators": ["Evelina Bakhturina", "Vitaly Lavrukhin", "Boris Ginsburg", "Yang Zhang"],
            "url": "https://www.openslr.org/109/", "license": "CC BY 4.0",
            "license_url": "https://creativecommons.org/licenses/by/4.0/",
            "notice": "AI-generated project prompts; voice adapted from a bounded clean speaker subset. No original corpus recordings exported."}],
    }
    assert_public(payload)
    files = {**audio_bytes, "demo-data.json": json_bytes(payload), "ATTRIBUTION.txt": ATTRIBUTION.encode("utf-8")}
    expected_paths = set(files) | {"SHA256SUMS"}
    if output.exists():
        extras = {path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file()} - expected_paths
        if extras:
            raise ValueError("Export folder contains unrecognized files; move them before exporting")
    for name, data in sorted(files.items()):
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    sums = "".join(f"{digest(data)}  {name}\n" for name, data in sorted(files.items()))
    (output / "SHA256SUMS").write_text(sums, encoding="utf-8")
    return verify_export(output)


def verify_export(output: Path) -> dict:
    """Validate a public export using no authoring metadata or excluded folders."""
    output = output.resolve()
    payload = load_json(output / "demo-data.json")
    assert_public(payload)
    inventory = payload["inventory"]
    if len(inventory) != 62 or len(payload["pairs"]) != 24 or len(payload["analyses"]) != 62:
        raise ValueError("Public demo must contain exactly 62 curated recordings and 24 A/B pairs")
    total_bytes = 0
    for item in inventory:
        relative = Path(item["path"])
        if relative.is_absolute() or ".." in relative.parts or not re.fullmatch(r"audio/(?:baseline|candidate|practice)/tts-\d{3}\.wav", relative.as_posix()):
            raise ValueError("Unexpected public audio path")
        path = (output / relative).resolve()
        if not path.is_relative_to(output):
            raise ValueError("Audio path leaves public export")
        data = path.read_bytes()
        if digest(data) != item["sha256"] or len(data) != item["bytes"]:
            raise ValueError(f"Public audio checksum differs: {relative}")
        wav_info(data)
        total_bytes += len(data)
    checked = set()
    for line in (output / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        sha, name = line.split("  ", 1)
        path = (output / name).resolve()
        if not path.is_relative_to(output) or path == output / "SHA256SUMS":
            raise ValueError("Invalid checksum manifest entry")
        if digest(path.read_bytes()) != sha:
            raise ValueError(f"Public asset checksum differs: {name}")
        checked.add(name)
    expected = {item["path"] for item in inventory} | {"demo-data.json", "ATTRIBUTION.txt"}
    if checked != expected:
        raise ValueError("Checksum manifest does not cover exactly the public export")
    return {"recordings": len(inventory), "pairs": len(payload["pairs"]), "text_references": len(payload["texts"]),
            "cached_ai_analyses": len(payload["analyses"]), "preferred_sentence_references": len(payload["reference_audio"]["by_text"]),
            "audio_bytes": total_bytes, "files_verified": len(checked), "private_paths_present": False}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--verify", action="store_true", help="Verify already exported public assets without excluded inputs")
    args = parser.parse_args()
    output = args.output_dir or args.project_root / "speech-training/demo-assets"
    summary = verify_export(output) if args.verify else export_assets(args.project_root, output)
    print(json.dumps(summary, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
