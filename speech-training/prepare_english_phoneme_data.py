#!/usr/bin/env python3
"""Download and prepare the full LibriSpeech train-clean-100/dev-clean/test-clean.

Download alone needs only Python's standard library. Preparation additionally
uses the existing speech-training environment (soundfile, scipy, transformers,
phonemizer/eSpeak). No model weights, private recordings, or user WAVs are read.

  python3 speech-training/prepare_english_phoneme_data.py download
  speech-training/.venv/bin/python speech-training/prepare_english_phoneme_data.py prepare

There is no implicit sample limit: train-clean-100 is the default source.
Canonical transcript-derived phones are explicitly not observed phone labels.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager
import hashlib
import http.client
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
DEFAULT_CONFIG = HERE / "resources/english-phoneme-training.json"
DEFAULT_OUTPUT = HERE / "data/english-phoneme-librispeech"
DEFAULT_MODEL = HERE / "models/phoneme-ctc"
SPLITS = ("train", "validation", "test")
ID_PATTERN = re.compile(r"^(\d+)-(\d+)-(\d+)$")
MAX_EXTRACTED_BYTES = 40 * 1024**3
MAX_EXTRACTED_FILES = 200_000


def file_digest(path: Path, algorithm: str = "sha256") -> str:
    digest = hashlib.new(algorithm)
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular_file(path: Path) -> bool:
    return path.is_file() and not path.is_symlink()


def atomic_json(path: Path, value: object) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def load_config(path: Path = DEFAULT_CONFIG) -> dict:
    config = json.loads(path.read_text(encoding="utf-8"))
    if config.get("schema_version") != 1 or set(config.get("splits", {})) != set(SPLITS):
        raise ValueError("Expected version 1 configuration with train, validation and test")
    for spec in config["splits"].values():
        if (not re.fullmatch(r"[a-z0-9-]+\.tar\.gz", spec.get("archive", ""))
                or not re.fullmatch(r"[a-z0-9-]+", spec.get("source_split", ""))
                or not re.fullmatch(r"[a-f0-9]{32}", spec.get("md5", ""))
                or not isinstance(spec.get("max_archive_bytes"), int) or spec["max_archive_bytes"] <= 0):
            raise ValueError("Invalid pinned archive configuration")
    return config


@contextmanager
def exclusive_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise RuntimeError(f"Another preparation may be running. Inspect/remove a stale lock before retrying: {path}") from error
    try:
        os.write(descriptor, str(os.getpid()).encode())
        os.close(descriptor)
        yield
    finally:
        path.unlink(missing_ok=True)


def verify_archive(path: Path, spec: dict) -> dict:
    if not regular_file(path):
        raise ValueError(f"Missing or symlinked archive: {path}")
    if path.stat().st_size > spec["max_archive_bytes"]:
        raise ValueError("Archive exceeds the configured download bound")
    actual = file_digest(path, "md5")
    if actual != spec["md5"]:
        raise ValueError(f"Official MD5 mismatch for {path.name}: {actual}")
    return {"archive": path.name, "bytes": path.stat().st_size, "md5": actual,
            "sha256": file_digest(path), "source_split": spec["source_split"]}


def download_archive(spec: dict, directory: Path, base_url: str, *, opener=urllib.request.urlopen,
                     retries: int = 5, retry_delay: float = 2.0) -> dict:
    """Resume only an accurately matching HTTP range; verify before publishing."""
    if not base_url.startswith("https://"):
        raise ValueError("Archive downloads require HTTPS")
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / spec["archive"]
    if destination.exists() or destination.is_symlink():
        result = verify_archive(destination, spec)
        print(f"Verified existing {destination.name}", flush=True)
        return result
    partial = destination.with_name(destination.name + ".part")
    if partial.is_symlink() or (partial.exists() and not partial.is_file()):
        raise ValueError("Partial download must be a regular file")
    url = base_url.rstrip("/") + "/" + spec["archive"]
    for attempt in range(retries):
        offset = partial.stat().st_size if partial.exists() else 0
        if offset > spec["max_archive_bytes"]:
            raise ValueError("Partial download exceeds configured bound")
        headers = {"User-Agent": "EnglishGarden-English-phoneme-preparation/1.0", "Accept-Encoding": "identity"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        request = urllib.request.Request(url, headers=headers)
        try:
            with opener(request, timeout=30) as response:
                status = getattr(response, "status", 200)
                if status not in (200, 206):
                    raise ValueError(f"Unexpected HTTP status {status}")
                total = None
                if status == 206:
                    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                    if not match or int(match[1]) != offset or int(match[2]) < offset:
                        raise ValueError("Server returned an incorrect resume range")
                    total = int(match[3])
                    if int(match[2]) >= total:
                        raise ValueError("Invalid resume total")
                elif offset:
                    print(f"Server ignored Range; restarting {destination.name} safely", flush=True)
                    offset = 0
                length = response.headers.get("Content-Length")
                if length is not None:
                    expected = int(length) + offset
                    if total is not None and expected != total:
                        raise ValueError("Range length does not match complete archive size")
                    total = expected
                if total is not None and (total <= 0 or total > spec["max_archive_bytes"]):
                    raise ValueError("Server archive size exceeds configured bound")
                received, last_report = offset, offset
                print(f"Downloading {destination.name} from byte {offset:,}", flush=True)
                with partial.open("ab" if offset else "wb") as handle:
                    while chunk := response.read(1024 * 1024):
                        received += len(chunk)
                        if received > spec["max_archive_bytes"] or (total is not None and received > total):
                            raise ValueError("Download exceeded its complete archive size")
                        handle.write(chunk)
                        if received - last_report >= 64 * 1024**2:
                            print(f"  {destination.name}: {received / 1024**2:.0f} MiB" + (f" / {total / 1024**2:.0f} MiB" if total else ""), flush=True)
                            last_report = received
                if total is not None and received != total:
                    raise urllib.error.URLError("Incomplete response; retrying with Range")
            try:
                result = verify_archive(partial, spec)
            except ValueError:
                partial.unlink(missing_ok=True)
                raise
            partial.replace(destination)
            result["archive"] = destination.name
            result["url"] = url
            print(f"Verified official MD5: {destination.name}", flush=True)
            return result
        except (urllib.error.URLError, http.client.IncompleteRead, TimeoutError, ConnectionError, OSError) as error:
            if attempt + 1 == retries:
                raise RuntimeError(f"Download interrupted; verified partial bytes retained for resume: {partial}") from error
            print(f"Connection interrupted; resume attempt {attempt + 2}/{retries}", flush=True)
            time.sleep(retry_delay)
    raise RuntimeError("Unreachable download state")


def download_all(config: dict, output: Path, splits=SPLITS, **kwargs) -> dict:
    output.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(output).free < 20 * 1024**3:
        raise RuntimeError("At least 20 GiB of free disk space is required before downloading archives and extracting the corpus")
    with exclusive_lock(output / ".download.lock"):
        records = {}
        for split in splits:
            records[split] = download_archive(config["splits"][split], output / "archives",
                                               config["source"]["download_base_url"], **kwargs)
        atomic_json(output / "download-provenance.json", {"source": config["source"], "archives": records})
    return records


def safe_member_path(member: tarfile.TarInfo) -> PurePosixPath:
    path = PurePosixPath(member.name)
    if (not member.name or path.is_absolute() or ".." in path.parts or "\\" in member.name
            or ":" in member.name or not path.parts or path.parts[0] != "LibriSpeech"
            or not (member.isdir() or member.isfile()) or member.issym() or member.islnk()):
        raise ValueError(f"Unsafe archive member: {member.name}")
    return path


def extract_archive(archive: Path, spec: dict, sources: Path) -> Path:
    provenance = verify_archive(archive, spec)
    sources.mkdir(parents=True, exist_ok=True)
    destination = sources / spec["source_split"]
    marker = destination / ".verified-extraction.json"
    if destination.is_symlink():
        raise ValueError("Extraction destination must not be a symlink")
    if destination.exists():
        if not regular_file(marker) or json.loads(marker.read_text()).get("md5") != spec["md5"]:
            raise ValueError("Existing extraction has no matching verification marker; preserve it and choose a clean output")
        return destination
    staging = Path(tempfile.mkdtemp(prefix=".extract-" + spec["source_split"] + "-", dir=sources))
    try:
        with tarfile.open(archive, "r:gz") as bundle:
            members = bundle.getmembers()
            if len(members) > MAX_EXTRACTED_FILES:
                raise ValueError("Too many archive members")
            total, seen = 0, set()
            for member in members:
                relative = safe_member_path(member)
                if relative.as_posix() in seen:
                    raise ValueError("Duplicate archive member path")
                seen.add(relative.as_posix())
                if member.size < 0 or member.size > 128 * 1024**2:
                    raise ValueError("Archive member size exceeds bound")
                total += member.size
                if total > MAX_EXTRACTED_BYTES:
                    raise ValueError("Extracted archive size exceeds bound")
                if len(relative.parts) > 1 and relative.parts[1] not in (spec["source_split"], "LICENSE.TXT", "README.TXT", "SPEAKERS.TXT", "CHAPTERS.TXT", "BOOKS.TXT"):
                    raise ValueError("Archive contains an unexpected source split or root file")
            for member in members:
                target = staging.joinpath(*safe_member_path(member).parts)
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    stream = bundle.extractfile(member)
                    if stream is None:
                        raise ValueError("Missing archive member data")
                    with stream, target.open("xb") as handle:
                        shutil.copyfileobj(stream, handle, 1024 * 1024)
                    if target.stat().st_size != member.size:
                        raise ValueError("Incomplete archive member")
        if not (staging / "LibriSpeech" / spec["source_split"]).is_dir():
            raise ValueError("Archive is missing its expected official split")
        atomic_json(staging / ".verified-extraction.json", provenance)
        staging.replace(destination)
        return destination
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def transcript_records(directory: Path, source_split: str) -> list[dict]:
    base = directory / "LibriSpeech" / source_split
    if not base.is_dir() or base.is_symlink():
        raise ValueError("Missing official extracted split")
    rows, seen = [], set()
    for transcript in sorted(base.rglob("*.trans.txt")):
        if not regular_file(transcript):
            raise ValueError("Transcript must be a regular file")
        for line in transcript.read_text(encoding="utf-8").splitlines():
            fields = line.strip().split(maxsplit=1)
            if len(fields) != 2 or not fields[1].strip():
                raise ValueError(f"Invalid transcript record in {transcript}")
            identifier, text = fields
            match = ID_PATTERN.fullmatch(identifier)
            if not match or identifier in seen or transcript.parent.name != match[2] or transcript.parent.parent.name != match[1]:
                raise ValueError("Duplicate or inconsistent LibriSpeech utterance identity")
            seen.add(identifier)
            audio = transcript.parent / (identifier + ".flac")
            if not regular_file(audio):
                raise ValueError(f"Missing or symlinked audio: {audio}")
            rows.append({"id": identifier, "text": text, "speaker_id": match[1], "chapter_id": match[2], "path": audio})
    if not rows:
        raise ValueError("Official split has no transcript records")
    discovered = {path.stem for path in base.rglob("*.flac")}
    if discovered != seen:
        raise ValueError("Audio/transcript inventory differs")
    return rows


def canonical_labeler(model_dir: Path):
    from transformers import Wav2Vec2PhonemeCTCTokenizer
    tokenizer = Wav2Vec2PhonemeCTCTokenizer.from_pretrained(model_dir, local_files_only=True,
                                                          phonemizer_lang="en-us", do_phonemize=True)
    vocabulary = tokenizer.get_vocab()
    special = set(tokenizer.all_special_tokens)

    def label(text):
        phones = tokenizer.tokenize(text)
        unknown = sorted({phone for phone in phones if phone not in vocabulary or phone in special})
        if unknown or not phones:
            raise ValueError("Out-of-vocabulary canonical phones: " + " ".join(unknown))
        return phones, [vocabulary[phone] for phone in phones]
    return label


def inspect_audio(path: Path, output: Path, split: str, identifier: str) -> dict:
    import soundfile as sf
    info = sf.info(path)
    if info.frames <= 0 or info.samplerate <= 0 or info.channels <= 0:
        raise ValueError("Invalid audio metadata")
    selected = path
    if info.samplerate != 16000 or info.channels != 1:
        import numpy as np
        from scipy.signal import resample_poly
        audio, rate = sf.read(path, dtype="float32", always_2d=True)
        if not np.isfinite(audio).all():
            raise ValueError("Nonfinite audio samples")
        mono = audio.mean(axis=1)
        divisor = math.gcd(rate, 16000)
        if rate != 16000:
            mono = resample_poly(mono, 16000 // divisor, rate // divisor)
        selected = output / "audio" / split / (identifier + ".wav")
        selected.parent.mkdir(parents=True, exist_ok=True)
        temporary = selected.with_suffix(".tmp.wav")
        sf.write(temporary, mono, 16000, subtype="PCM_16")
        temporary.replace(selected)
        info = sf.info(selected)
    return {"audio": selected.relative_to(output).as_posix(), "sample_rate_hz": 16000,
            "duration_seconds": round(info.frames / info.samplerate, 6),
            "audio_sha256": file_digest(selected), "frames": info.frames}


def normalized_text(text: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+(?:'[a-z0-9]+)?", text.casefold()))


def build_manifests(records: dict, output: Path, label, audio_inspector=inspect_audio, *,
                    oov_policy: str = "exclude") -> dict:
    """Keep official speakers separate; held-out examples win duplicate removal."""
    if set(records) != set(SPLITS):
        raise ValueError("All three official partitions are required")
    output.mkdir(parents=True, exist_ok=True)
    speakers = {split: {row["speaker_id"] for row in rows} for split, rows in records.items()}
    if any(speakers[a] & speakers[b] for a, b in (("train", "validation"), ("train", "test"), ("validation", "test"))):
        raise ValueError("Speaker leakage between official partitions")
    staging = Path(tempfile.mkdtemp(prefix=".manifests-", dir=output))
    summaries, seen_ids, seen_texts, seen_audio = {}, set(), set(), set()
    try:
        for split in ("test", "validation", "train"):
            rejected, duration, count, phone_counts = Counter(), 0.0, 0, Counter()
            accepted_speakers = set()
            with (staging / (split + ".jsonl")).open("w", encoding="utf-8") as handle:
                for row in sorted(records[split], key=lambda item: item["id"]):
                    if row["id"] in seen_ids:
                        raise ValueError("Utterance identity leakage between official partitions")
                    seen_ids.add(row["id"])
                    key = normalized_text(row["text"])
                    if not key:
                        rejected["empty_text"] += 1; continue
                    if key in seen_texts:
                        rejected["duplicate_transcript"] += 1; continue
                    try:
                        phones, phone_ids = label(row["text"])
                    except ValueError:
                        if oov_policy == "fail":
                            raise
                        rejected["canonical_phone_oov"] += 1; continue
                    if len(phones) != len(phone_ids) or not phones or any(not isinstance(value, int) or value <= 0 for value in phone_ids):
                        raise ValueError("Invalid canonical label/ID sequence")
                    info = audio_inspector(row["path"], output, split, row["id"])
                    if (not math.isfinite(info["duration_seconds"]) or info["duration_seconds"] <= 0
                            or info["sample_rate_hz"] != 16000):
                        raise ValueError("Expected finite nonempty mono 16kHz audio")
                    if info["audio_sha256"] in seen_audio:
                        rejected["duplicate_audio"] += 1; continue
                    seen_audio.add(info["audio_sha256"]); seen_texts.add(key)
                    item = {key: row[key] for key in ("id", "text", "speaker_id", "chapter_id")}
                    item.update(info)
                    item.update({"split": split, "phones": phones, "phone_ids": phone_ids,
                                 "label_source": "canonical_espeak", "label_kind": "canonical_text_reference",
                                 "human_reviewed": False})
                    handle.write(json.dumps(item, ensure_ascii=False, allow_nan=False) + "\n")
                    duration += info["duration_seconds"]; count += 1; phone_counts.update(phones)
                    accepted_speakers.add(row["speaker_id"])
                    if count % 500 == 0:
                        print(f"Prepared {split}: {count:,} utterances", flush=True)
            if not count:
                raise ValueError(f"No accepted records in {split}")
            summaries[split] = {"manifest": split + ".jsonl", "count": count,
                                "manifest_sha256": file_digest(staging / (split + ".jsonl")),
                                "audio_seconds": round(duration, 3), "speakers": len(accepted_speakers),
                                "source_speakers": len(speakers[split]),
                                "rejected": dict(rejected), "phone_counts": dict(sorted(phone_counts.items()))}
        for split in SPLITS:
            (staging / (split + ".jsonl")).replace(output / (split + ".jsonl"))
        return summaries
    finally:
        shutil.rmtree(staging)


def prepare(config: dict, output: Path, model_dir: Path, *, oov_policy="exclude") -> dict:
    output.mkdir(parents=True, exist_ok=True)
    with exclusive_lock(output / ".prepare.lock"):
        vocab = model_dir / "vocab.json"
        if not regular_file(vocab):
            raise ValueError("Missing local phoneme model vocabulary")
        label = canonical_labeler(model_dir)
        records, archives = {}, {}
        for split in SPLITS:
            spec = config["splits"][split]
            archive = output / "archives" / spec["archive"]
            archives[split] = verify_archive(archive, spec)
            source = extract_archive(archive, spec, output / "sources")
            records[split] = transcript_records(source, spec["source_split"])
        summary = build_manifests(records, output, label, oov_policy=oov_policy)
        metadata = {"schema_version": 1, "status": "prepared", "source": config["source"],
                    "archives": archives, "splits": summary, "sample_rate_hz": 16000,
                    "labels": config["labels"], "vocabulary_sha256": file_digest(vocab),
                    "vocabulary_size": len(json.loads(vocab.read_text())),
                    "quality_control": {"official_partitions": True, "speaker_disjoint": True,
                                        "duplicate_text_and_audio_removed": True,
                                        "held_out_priority": ["test", "validation", "train"],
                                        "oov_policy": oov_policy, "implicit_sample_limit": None,
                                        "user_recordings_included": False,
                                        "human_phone_annotation": False}}
        atomic_json(output / "dataset-info.json", metadata)
        (output / "ATTRIBUTION.txt").write_text(config["source"]["attribution"] + "\n" + config["source"]["official_page"] + "\n"
            + config["source"]["license"] + " " + config["source"]["license_url"] + "\n\n"
            + "Transcript references converted to en-us eSpeak canonical phones. Non-mono/non-16k audio resampled to mono16k; original FLAC preserved.\n"
            + config["labels"]["warning"] + "\n", encoding="utf-8")
        return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("action", choices=("download", "prepare", "all"))
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--splits", choices=SPLITS, nargs="+", default=list(SPLITS), help="Download only; preparation always verifies all official partitions")
    parser.add_argument("--oov-policy", choices=("exclude", "fail"), default="exclude", help="OOV canonical phones are explicitly counted, never mapped to unknown labels")
    args = parser.parse_args()
    config, output = load_config(args.config), args.output.resolve()
    if args.action in ("download", "all"):
        download_all(config, output, args.splits)
    if args.action in ("prepare", "all"):
        result = prepare(config, output, args.model_dir.resolve(), oov_policy=args.oov_policy)
        print(json.dumps({"status": result["status"], "output": str(output), "splits": result["splits"]}, indent=2, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
