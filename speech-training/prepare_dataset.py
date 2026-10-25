#!/usr/bin/env python3
"""Prepare a bounded, reproducible female English Hi-Fi TTS subset.

Run with speech-training/.venv/bin/python speech-training/prepare_dataset.py.
Downloads one pinned Parquet shard, never the complete corpus. Audio paths in
JSONL manifests are relative to the output data directory. Original FLAC bytes
remain in the source Parquet; training WAVs are derived at 24 kHz.
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath
import re
import urllib.request

import numpy as np
import pyarrow.parquet as pq
from scipy.signal import resample_poly
import soundfile as sf

REPO = "MikhailT/hifi-tts"
REVISION = "f0a934ddf4e8da0fc6c53fb42fda2c9ac8ed93df"
SHARD = "train.clean-00028-of-00035-bf52d0eb4f65af2d.parquet"
SOURCE_SIZE = 410716749
SOURCE_SHA256 = "643f10eb06c32c782e6bccaf88318b594abaf0df73f564aee81d094f31ac9f07"
SOURCE_URL = f"https://huggingface.co/datasets/{REPO}/resolve/{REVISION}/data/{SHARD}"
SPEAKER = "92"
SPEAKER_NAME = "Cori Samuel"
SEED = "english-garden-tts-20261024-v1"
TARGET_RATE = 24000
LIMITS = {"train": 512, "valid": 32, "test": 32}


def normalized(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", text.casefold()))


def stable_key(value: str) -> str:
    return hashlib.sha256(f"{SEED}:{value}".encode()).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def download_source(destination: Path) -> None:
    """Check a bounded download; resume partial downloads only with HTTP 206."""
    if destination.exists():
        if destination.stat().st_size != SOURCE_SIZE:
            raise RuntimeError(f"Unexpected existing source size: {destination}")
        print(f"Reusing pinned source shard: {destination}", flush=True)
        return
    partial = destination.with_suffix(destination.suffix + ".part")
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > SOURCE_SIZE:
        raise RuntimeError("Partial download exceeds the expected shard size")
    headers = {"User-Agent": "EnglishGardenLab-TTS-data-preparation/1.0"}
    if offset:
        headers["Range"] = f"bytes={offset}-"
    request = urllib.request.Request(SOURCE_URL, headers=headers)
    print(f"Downloading ONE shard ({SOURCE_SIZE:,} bytes): {SHARD}", flush=True)
    with urllib.request.urlopen(request, timeout=90) as response:
        if offset and response.status != 206:
            raise RuntimeError("Cannot safely resume: server did not honor Range")
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) + offset > SOURCE_SIZE:
            raise RuntimeError("Server response exceeds the approved download bound")
        received = offset
        last_report = offset
        with partial.open("ab" if offset else "wb") as handle:
            while chunk := response.read(1024 * 1024):
                received += len(chunk)
                if received > SOURCE_SIZE:
                    raise RuntimeError("Download exceeded the pinned source size")
                handle.write(chunk)
                if received - last_report >= 32 * 1024 * 1024:
                    print(f"  {received / 1024**2:.0f}/{SOURCE_SIZE / 1024**2:.0f} MiB", flush=True)
                    last_report = received
    if partial.stat().st_size != SOURCE_SIZE:
        raise RuntimeError("Source download is incomplete; rerun to resume")
    partial.replace(destination)


def chapter_group(source_file: str) -> str:
    path = PurePosixPath(source_file)
    # Original names: audio/92_clean/9288/scarletletter_01_hawthorne_0009.flac.
    stem, separator, utterance = path.stem.rpartition("_")
    if not separator or not utterance.isdigit():
        raise ValueError(f"Cannot derive a source chapter: {source_file}")
    return f"{path.parent.name}/{stem}"


def prepare(output: Path, evaluation_file: Path) -> dict:
    source_dir = output / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    source_path = source_dir / SHARD
    download_source(source_path)
    checksum = sha256_file(source_path)
    if checksum != SOURCE_SHA256:
        raise RuntimeError("Source SHA256 differs from the first verified pinned retrieval")
    print(f"Source SHA256: {checksum}", flush=True)

    evaluation = json.loads(evaluation_file.read_text(encoding="utf-8"))
    heldout_texts = {normalized(item["text"]) for item in evaluation["prompts"]}
    columns = ["speaker", "file", "duration", "text_normalized", "audio"]
    table = pq.read_table(source_path, columns=columns)
    metadata = table.select(["speaker", "file", "duration", "text_normalized"]).to_pylist()
    candidates = []
    seen_texts = set()
    rejected = collections.Counter()
    for index, item in enumerate(metadata):
        if str(item["speaker"]) != SPEAKER:
            rejected["other_speaker"] += 1
            continue
        if not 3.0 <= float(item["duration"]) <= 8.0:
            rejected["outside_3_to_8_seconds"] += 1
            continue
        text = item["text_normalized"].strip()
        text_key = normalized(text)
        if not text_key or len(text_key.split()) < 3:
            rejected["insufficient_text"] += 1
            continue
        if text_key in heldout_texts:
            rejected["evaluation_prompt_overlap"] += 1
            continue
        if text_key in seen_texts:
            rejected["duplicate_normalized_text"] += 1
            continue
        seen_texts.add(text_key)
        candidates.append({"index": index, "text": text, "source_file": item["file"],
                           "source_group": chapter_group(item["file"])})

    grouped = collections.defaultdict(list)
    for item in candidates:
        grouped[item["source_group"]].append(item)
    adequate = sorted((group for group in grouped if len(grouped[group]) >= 40), key=stable_key)
    if len(adequate) < 3:
        raise RuntimeError("Need at least three source chapters with adequate examples")
    group_assignments = {adequate[0]: "test", adequate[1]: "valid"}
    print(f"Eligible: {len(candidates)} clips in {len(grouped)} chapters; "
          f"test={adequate[0]}, valid={adequate[1]}", flush=True)

    split_candidates = collections.defaultdict(list)
    for item in candidates:
        split_candidates[group_assignments.get(item["source_group"], "train")].append(item)
    manifests = {split: [] for split in LIMITS}
    for split, wanted in LIMITS.items():
        audio_dir = output / "audio" / split
        audio_dir.mkdir(parents=True, exist_ok=True)
        for item in sorted(split_candidates[split], key=lambda x: stable_key(x["source_file"])):
            if len(manifests[split]) >= wanted:
                break
            embedded = table.column("audio")[item["index"]].as_py()
            raw_audio = embedded["bytes"]
            if not raw_audio:
                rejected["missing_embedded_audio"] += 1
                continue
            waveform, source_rate = sf.read(io.BytesIO(raw_audio), dtype="float32", always_2d=True)
            if source_rate != 44100 or waveform.shape[1] != 1:
                rejected["unexpected_source_audio_format"] += 1
                continue
            waveform = waveform[:, 0]
            duration = len(waveform) / source_rate
            if not 2.99 <= duration <= 8.01 or not np.isfinite(waveform).all():
                rejected["invalid_decoded_audio"] += 1
                continue
            if float(np.max(np.abs(waveform))) < 1e-4:
                rejected["near_silent_audio"] += 1
                continue
            if float(np.mean(np.abs(waveform) >= 0.999)) > 0.005:
                rejected["excessive_clipping"] += 1
                continue
            divisor = math.gcd(source_rate, TARGET_RATE)
            derived = resample_poly(waveform, TARGET_RATE // divisor, source_rate // divisor)
            clip_id = f"hifi92-{hashlib.sha256(item['source_file'].encode()).hexdigest()[:16]}"
            relative_audio = f"audio/{split}/{clip_id}.wav"
            sf.write(output / relative_audio, derived, TARGET_RATE, subtype="PCM_16")
            manifests[split].append({
                "id": clip_id, "audio": relative_audio, "text": item["text"],
                "speaker_id": SPEAKER, "duration_seconds": round(len(derived) / TARGET_RATE, 6),
                "source_file": item["source_file"], "source_group": item["source_group"]
            })
        if len(manifests[split]) != wanted:
            raise RuntimeError(f"Only {len(manifests[split])}/{wanted} usable {split} clips")
        with (output / f"{split}.jsonl").open("w", encoding="utf-8") as handle:
            for record in manifests[split]:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    source_groups = {split: {row["source_group"] for row in rows} for split, rows in manifests.items()}
    for left, right in [("train", "valid"), ("train", "test"), ("valid", "test")]:
        assert not (source_groups[left] & source_groups[right]), "Source chapter leakage"
        assert not ({normalized(x["text"]) for x in manifests[left]} &
                    {normalized(x["text"]) for x in manifests[right]}), "Text leakage"
    assert not (heldout_texts & {normalized(x["text"]) for rows in manifests.values() for x in rows})

    source = {
        "name": "Hi-Fi Multi-Speaker English TTS Dataset",
        "official_page": "https://www.openslr.org/109/",
        "paper": "https://arxiv.org/abs/2104.01497",
        "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "authors": ["Evelina Bakhturina", "Vitaly Lavrukhin", "Boris Ginsburg", "Yang Zhang"],
        "speaker_id": SPEAKER, "speaker_name": SPEAKER_NAME,
        "speaker_description": "Female English audiobook reader",
        "mirror_repository": REPO, "mirror_revision": REVISION,
        "download_url": SOURCE_URL, "local_file": f"source/{SHARD}",
        "bytes": SOURCE_SIZE, "sha256": checksum,
        "source_sample_rate_hz": 44100,
        "original_audio_preserved": "Original embedded FLAC bytes retained in the source Parquet shard.",
        "transcript_column": "text_normalized",
        "checked_on": "2026-10-24", "timezone": "Asia/Bangkok"
    }
    reference = min(manifests["train"], key=lambda x: abs(x["duration_seconds"] - 6))
    info = {
        "schema_version": 1, "source": source, "language": "en", "sample_rate_hz": TARGET_RATE,
        "seed": SEED, "requested_counts": LIMITS,
        "splits": {split: {
            "manifest": f"{split}.jsonl", "count": len(rows),
            "audio_seconds": round(sum(row["duration_seconds"] for row in rows), 3),
            "source_groups": sorted(source_groups[split])
        } for split, rows in manifests.items()},
        "reference": {key: reference[key] for key in ["audio", "text", "id"]},
        "quality_control": {
            "duration_range_seconds": [3, 8], "single_speaker": True,
            "chapter_disjoint": True, "duplicate_normalized_texts_removed": True,
            "evaluation_prompts_excluded": str(evaluation_file.resolve()),
            "evaluation_prompts_sha256": sha256_file(evaluation_file),
            "rejected": dict(rejected), "human_audio_transcript_review": "not_performed",
            "limitations": [
                "One bounded shard is a convenience subset, not a representative sample of the corpus.",
                "Chapter separation reduces adjacent-utterance leakage; recording-session identity is unavailable.",
                "Read audiobook speech does not establish natural conversational tutoring prosody.",
                "No naturalness improvement is established by data preparation or training loss alone."
            ]
        }
    }
    write_json(output / "dataset-info.json", info)
    write_json(source_dir / "provenance.json", source)
    (source_dir / "ATTRIBUTION.md").write_text(
        "# Hi-Fi TTS source attribution\n\n"
        "Hi-Fi Multi-Speaker English TTS Dataset, Evelina Bakhturina, Vitaly Lavrukhin, "
        "Boris Ginsburg and Yang Zhang (2021). Speaker 92: Cori Samuel.\n\n"
        "Source: https://www.openslr.org/109/\n"
        "Paper: https://arxiv.org/abs/2104.01497\n"
        "License: Creative Commons Attribution 4.0 International (CC BY 4.0), "
        "https://creativecommons.org/licenses/by/4.0/\n\n"
        f"Mirror: https://huggingface.co/datasets/{REPO}/tree/{REVISION}\n"
        f"Pinned source SHA256: {checksum}\n\n"
        "Modifications: one female-speaker subset, length and automatic signal checks, "
        "transcript deduplication, chapter-disjoint splits, resampling from 44.1 kHz to "
        "24 kHz mono 16-bit PCM WAV. Original source audio remains in the Parquet. "
        "The dataset creators and reader do not endorse this project.\n",
        encoding="utf-8"
    )
    print(json.dumps({"output": str(output), "splits": info["splits"], "reference": info["reference"]}, indent=2), flush=True)
    return info


def main() -> None:
    project = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=project / "data")
    parser.add_argument("--evaluation-prompts", type=Path,
                        default=project / "resources/evaluation-prompts.json")
    args = parser.parse_args()
    prepare(args.output.resolve(), args.evaluation_prompts.resolve())


if __name__ == "__main__":
    main()
