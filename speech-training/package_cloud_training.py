"""Create an explicit public-LibriSpeech-only input bundle; never upload or train.

Defaults to a small pilot. --scope full includes the existing 100-hour split.
Only verified corpus rows, required model files, and the trainer are included.
The OpenAI key file is unrelated to this workflow and is never opened.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import tarfile
import io

HERE = Path(__file__).resolve().parent
MODEL_FILES = ("config.json", "vocab.json", "preprocessor_config.json", "tokenizer_config.json", "special_tokens_map.json")
SPLITS = {"train": "train-clean-100", "validation": "dev-clean", "test": "test-clean"}
PILOT_LIMITS = {"train": 256, "validation": 32, "test": 32}


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def public_audio(data, row, split):
    relative = row.get("audio", "")
    # Do not accept a general file selector: this exporter is only for the
    # already-prepared official corpus, not Downloads or learner recordings.
    corpus_split = SPLITS[split]
    pattern = r"sources/" + corpus_split + "/LibriSpeech/" + corpus_split + r"/(\d+)/(\d+)/(\d+)-(\d+)-(\d+)\.flac"
    match = re.fullmatch(pattern, relative)
    if not match or match[1] != match[3] or match[2] != match[4]:
        raise ValueError("Only official LibriSpeech corpus paths may be packaged")
    path = data / relative
    if path.is_symlink() or not path.resolve().is_relative_to(data.resolve()) or not path.is_file():
        raise ValueError("Corpus audio must be a contained regular file")
    actual = digest(path)
    if row.get("audio_sha256") != actual:
        raise ValueError("Corpus audio checksum does not match its prepared manifest")
    return path


def inputs(model, data, scope):
    from train_english_phoneme import load_splits
    vocabulary = json.loads((model / "vocab.json").read_text())
    partitions, _, _ = load_splits(data, vocabulary, 35.0)
    files, generated, statistics = {}, {}, {}
    for filename in MODEL_FILES:
        files["model/" + filename] = model / filename
    weights = "model.safetensors" if (model / "model.safetensors").is_file() else "pytorch_model.bin"
    files["model/" + weights] = model / weights
    files["code/train_english_phoneme.py"] = HERE / "train_english_phoneme.py"
    speakers = {}
    for split, rows in partitions.items():
        selected = rows if scope == "full" else rows[:PILOT_LIMITS[split]]
        clean = []
        for record in selected:
            row = {key: value for key, value in record.items() if key != "resolved_audio"}
            path = public_audio(data, row, split)
            files["data/" + row["audio"]] = path
            clean.append(row)
        generated["data/" + split + ".jsonl"] = ("\n".join(json.dumps(row, ensure_ascii=False) for row in clean) + "\n").encode()
        statistics[split] = {"utterances": len(clean), "hours": sum(row["duration_seconds"] for row in clean) / 3600}
        speakers[split] = {row["speaker_id"] for row in clean}
    if any(speakers[a] & speakers[b] for a, b in (("train", "validation"), ("train", "test"), ("validation", "test"))):
        raise ValueError("Speaker split leakage")
    for path in files.values():
        if not path.is_file() or path.is_symlink():
            raise ValueError("Required bundle input is missing or is a symlink")
    return files, generated, statistics


def package(model, data, output, scope="pilot"):
    files, generated, statistics = inputs(model.resolve(), data.resolve(), scope)
    if output.exists():
        raise ValueError("Choose a new output directory; existing bundles are never overwritten")
    output.mkdir(parents=True)
    manifest = {"schema_version": 1, "scope": scope, "private_audio": False,
                "dataset": "LibriSpeech train-clean-100/dev-clean/test-clean", "license": "CC-BY-4.0",
                "source": "https://www.openslr.org/12", "model_source": json.loads((HERE / "phonetic-model-source.json").read_text()),
                "label_limitation": "Canonical eSpeak transcript labels, not expert pronunciation scores",
                "statistics": statistics, "files": {}}
    archive = output / "training-input.tar"
    try:
        with tarfile.open(archive, "x") as tar:
            for name, path in sorted(files.items()):
                manifest["files"][name] = {"bytes": path.stat().st_size, "sha256": digest(path)}
                tar.add(path, arcname=name, recursive=False)
            for name, content in sorted(generated.items()):
                info = tarfile.TarInfo(name); info.size = len(content); info.mode = 0o644
                tar.addfile(info, io.BytesIO(content))
                manifest["files"][name] = {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
        manifest["archive_sha256"] = digest(archive)
        manifest["archive_bytes"] = archive.stat().st_size
        (output / "bundle.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    except BaseException:
        archive.unlink(missing_ok=True)
        raise
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=HERE / "models/phoneme-ctc")
    parser.add_argument("--data", type=Path, default=HERE / "data/english-phoneme-librispeech")
    parser.add_argument("--scope", choices=("pilot", "full"), default="pilot")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = package(args.model, args.data, args.output, args.scope)
    print(json.dumps({"created": str(args.output), "scope": args.scope, "bytes": result["archive_bytes"],
                      "statistics": result["statistics"], "uploaded": False, "trained": False}))


if __name__ == "__main__":
    main()
