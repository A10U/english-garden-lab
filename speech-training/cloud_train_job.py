# /// script
# requires-python = ">=3.12"
# dependencies = [
#   "torch==2.14.1",
#   "transformers==5.20.2",
#   "numpy==2.4.6",
#   "soundfile==0.14.0",
#   "huggingface-hub==2.3.0",
#   "safetensors==0.8.0",
# ]
# ///
"""Bounded CUDA pilot for an explicit private, pinned public-LibriSpeech bundle.

Run only after reviewing the bundle and HF Jobs cost/timeout. This script does
not submit Jobs, create repositories, read local key files, or deploy a model.
HF_TOKEN must be injected as a remote Job secret. Only a new runs/cloud-* folder
in a pre-created PRIVATE model repository is written. Training receives no token.

Example (submission is a paid action; placeholders are not ready credentials):
  hf jobs uv run --flavor a10g-small --timeout 30m --secrets HF_TOKEN \
    speech-training/cloud_train_job.py --input-repo USER/PRIVATE_DATASET \
    --input-revision FULL_40_CHARACTER_COMMIT --output-repo USER/PRIVATE_MODEL

Pilot only: <=50 optimizer steps; trainer wall time <=20 minutes, then SIGTERM
and at most 60 seconds grace. Job's external 30-minute limit also covers setup,
download and upload. No completed 100-hour training or CUDA test is implied.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid
import zipfile

ENDPOINT = "https://huggingface.co"
MODEL_FILES = ("config.json", "vocab.json", "preprocessor_config.json", "tokenizer_config.json", "special_tokens_map.json")
SPLITS = {"train": "train-clean-100", "validation": "dev-clean", "test": "test-clean"}
PILOT_LIMITS = {"train": 256, "validation": 32, "test": 32}
MAX_ARCHIVE_BYTES = 4 * 1024**3
MAX_TOTAL_BYTES = 4 * 1024**3
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_OUTPUT_BYTES = 8 * 1024**3
TRAINING_SECONDS = 20 * 60
GRACE_SECONDS = 60
SHA = re.compile(r"[a-f0-9]{64}")
REVISION = re.compile(r"[a-fA-F0-9]{40}")
AUDIO = re.compile(r"data/sources/(train-clean-100|dev-clean|test-clean)/LibriSpeech/\1/(\d+)/(\d+)/(\d+)-(\d+)-(\d+)\.flac")
OUTPUT_FILES = {"status.json", "run-config.json", "result.json", "metrics.jsonl", "checkpoint.pt", "best-adapter.pt"}
CANDIDATE_FILES = set(MODEL_FILES) | {"model.safetensors", "pytorch_model.bin"}


class JobError(ValueError):
    """Messages are fixed diagnostics, never arbitrary provider errors."""


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def object_json(path, maximum=MAX_MANIFEST_BYTES):
    path = Path(path)
    if not path.is_file() or path.is_symlink() or not 0 < path.stat().st_size <= maximum:
        raise JobError("Expected a bounded nonempty regular JSON file")
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise JobError("Duplicate JSON key")
            result[key] = value
        return result
    try:
        value = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique,
                           parse_constant=lambda _value: (_ for _ in ()).throw(JobError("Nonfinite JSON value")))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise JobError("Invalid JSON input") from error
    if not isinstance(value, dict):
        raise JobError("Expected a JSON object")
    return value


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def repo_id(value):
    if (not isinstance(value, str) or len(value) > 193 or
        not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,95}/[A-Za-z0-9][A-Za-z0-9._-]{0,95}", value)
        or ".." in value or "--" in value or value.endswith((".", ".git"))):
        raise JobError("Expected an explicit namespace/repository identifier")
    return value


def require_token(environ):
    token = environ.get("HF_TOKEN", "")
    if not isinstance(token, str) or not re.fullmatch(r"hf_[A-Za-z0-9]{20,509}", token):
        raise JobError("Inject a new HF_TOKEN as a remote Job secret; no token file is read")
    return token


class HubTransport:
    def __init__(self, token):
        from huggingface_hub import HfApi, hf_hub_download
        self.token = token
        self.api = HfApi(endpoint=ENDPOINT, token=token)
        self.downloader = hf_hub_download

    def info(self, repo, kind, revision=None):
        return self.api.repo_info(repo_id=repo, repo_type=kind, revision=revision, token=self.token)

    def download(self, repo, revision, filename, cache):
        downloaded = Path(self.downloader(repo_id=repo, repo_type="dataset", revision=revision,
                                         filename=filename, token=self.token, endpoint=ENDPOINT,
                                         cache_dir=cache, etag_timeout=30)).resolve()
        if not downloaded.is_relative_to(Path(cache).resolve()):
            raise JobError("Downloaded input escaped its owned cache")
        return downloaded

    def upload_file(self, repo, source, destination):
        return self.api.upload_file(repo_id=repo, repo_type="model", token=self.token,
                                    path_or_fileobj=str(source), path_in_repo=destination,
                                    commit_message="Reserve bounded pronunciation pilot run")

    def upload_folder(self, repo, folder, destination):
        return self.api.upload_folder(repo_id=repo, repo_type="model", token=self.token,
                                      folder_path=str(folder), path_in_repo=destination,
                                      commit_message="Save bounded pronunciation pilot artifacts")


def private_repo(transport, repo, kind, revision=None):
    info = transport.info(repo, kind, revision)
    if getattr(info, "private", None) is not True:
        raise JobError("Input and output repositories must already exist and be PRIVATE")
    if revision is not None and str(getattr(info, "sha", "")).lower() != revision.lower():
        raise JobError("Input repository did not resolve to the requested full commit")
    return info


def allowed_input(name):
    if not isinstance(name, str) or not name or "\\" in name or ":" in name or "\0" in name:
        return False
    path = PurePosixPath(name)
    if path.is_absolute() or name != path.as_posix() or any(part in ("", ".", "..") for part in path.parts):
        return False
    if name in {"code/train_english_phoneme.py", *(f"model/{x}" for x in MODEL_FILES),
                "model/model.safetensors", "model/pytorch_model.bin", *(f"data/{x}.jsonl" for x in SPLITS)}:
        return True
    match = AUDIO.fullmatch(name)
    return bool(match and match[2] == match[4] and match[3] == match[5])


def validate_bundle(manifest_path):
    manifest = object_json(manifest_path)
    if (manifest.get("schema_version") != 1 or manifest.get("scope") != "pilot" or
        manifest.get("private_audio") is not False or manifest.get("license") != "CC-BY-4.0" or
        manifest.get("dataset") != "LibriSpeech train-clean-100/dev-clean/test-clean" or
        manifest.get("source") != "https://www.openslr.org/12"):
        raise JobError("Only the explicit public-LibriSpeech pilot bundle is supported")
    if not SHA.fullmatch(str(manifest.get("archive_sha256", ""))):
        raise JobError("Missing archive SHA256")
    size = manifest.get("archive_bytes")
    if type(size) is not int or not 0 < size <= MAX_ARCHIVE_BYTES:
        raise JobError("Archive size exceeds the pilot bound")
    files = manifest.get("files")
    if not isinstance(files, dict) or not 10 < len(files) <= 330:
        raise JobError("Missing or oversized pilot file manifest")
    total = 0
    for name, spec in files.items():
        if not allowed_input(name) or not isinstance(spec, dict) or set(spec) != {"bytes", "sha256"}:
            raise JobError("Unapproved bundle path or file metadata")
        size = spec["bytes"]
        limit = 2 * 1024**3 if name.startswith("model/") else 32 * 1024**2
        if type(size) is not int or not 0 < size <= limit or not SHA.fullmatch(str(spec["sha256"])):
            raise JobError("Invalid per-file size or SHA256")
        total += size
    required = {"code/train_english_phoneme.py", *(f"model/{x}" for x in MODEL_FILES), *(f"data/{x}.jsonl" for x in SPLITS)}
    weights = set(files) & {"model/model.safetensors", "model/pytorch_model.bin"}
    if not required <= set(files) or len(weights) != 1 or total > MAX_TOTAL_BYTES:
        raise JobError("Missing required inputs, ambiguous base weights or oversized payload")
    return manifest


def extract_bundle(archive, manifest, destination):
    archive, destination = Path(archive), Path(destination)
    if not archive.is_file() or archive.is_symlink() or archive.stat().st_size != manifest["archive_bytes"] or digest(archive) != manifest["archive_sha256"]:
        raise JobError("Input archive size or SHA256 does not match bundle.json")
    destination.mkdir(parents=True, exist_ok=False)
    seen = set()
    try:
        with tarfile.open(archive, mode="r:") as bundle:
            for member in bundle:
                name = member.name
                if (not allowed_input(name) or name in seen or name not in manifest["files"] or
                    not member.isfile() or member.issparse() or member.linkname or
                    member.size != manifest["files"][name]["bytes"]):
                    raise JobError("Unlisted, duplicate, unsafe or mismatched tar member")
                seen.add(name)
                target = destination / name
                target.parent.mkdir(parents=True, exist_ok=True)
                content = bundle.extractfile(member)
                if content is None:
                    raise JobError("Missing tar member data")
                checksum, copied = hashlib.sha256(), 0
                with content, target.open("xb") as output:
                    for block in iter(lambda: content.read(1024 * 1024), b""):
                        copied += len(block)
                        if copied > member.size:
                            raise JobError("Tar member exceeded its declared size")
                        checksum.update(block); output.write(block)
                if copied != member.size or checksum.hexdigest() != manifest["files"][name]["sha256"]:
                    raise JobError("Tar member checksum does not match bundle.json")
        if seen != set(manifest["files"]):
            raise JobError("Archive omits listed files")
    except (tarfile.TarError, OSError, EOFError) as error:
        shutil.rmtree(destination, ignore_errors=True)
        raise JobError("Unable to read complete safe input archive") from error
    except BaseException:
        shutil.rmtree(destination, ignore_errors=True)
        raise
    return destination


def validate_rows(extracted, manifest):
    vocabulary = object_json(extracted / "model/vocab.json")
    if not vocabulary or any(type(value) is not int for value in vocabulary.values()) or len(set(vocabulary.values())) != len(vocabulary):
        raise JobError("Invalid model vocabulary")
    used, identities, hashes, speaker_sets = set(), set(), set(), {}
    statistics = {}
    keys = {"id", "text", "speaker_id", "chapter_id", "audio", "sample_rate_hz", "duration_seconds",
            "audio_sha256", "frames", "split", "phones", "phone_ids", "label_source", "label_kind", "human_reviewed"}
    for split, source in SPLITS.items():
        rows = (extracted / f"data/{split}.jsonl").read_text(encoding="utf-8").splitlines()
        rows = [json.loads(line) for line in rows if line.strip()]
        if not 0 < len(rows) <= PILOT_LIMITS[split]:
            raise JobError("Pilot partition exceeds its explicit example limit")
        speakers, seconds = set(), 0.0
        for row in rows:
            if not isinstance(row, dict) or not set(row) <= keys:
                raise JobError("Unexpected training row metadata")
            name = "data/" + str(row.get("audio", ""))
            match = AUDIO.fullmatch(name)
            if not match or not allowed_input(name) or match[1] != source or name not in manifest["files"]:
                raise JobError("Training row points outside its declared public corpus split")
            if (row.get("split") != split or str(row.get("speaker_id", "")) != match[2] or
                row.get("id") != f"{match[2]}-{match[3]}-{match[6]}" or
                row.get("label_source") != "canonical_espeak" or row.get("label_kind") != "canonical_text_reference" or
                row.get("human_reviewed") is not False or row.get("sample_rate_hz") != 16000 or
                not isinstance(row.get("text"), str) or not row["text"].strip() or
                row.get("audio_sha256") != manifest["files"][name]["sha256"]):
                raise JobError("Invalid public-corpus identity or canonical label provenance")
            duration = row.get("duration_seconds")
            if type(duration) not in (int, float) or not math.isfinite(duration) or not .3 <= duration <= 35:
                raise JobError("Invalid pilot audio duration")
            phones, ids = row.get("phones"), row.get("phone_ids")
            if not isinstance(phones, list) or not phones or not isinstance(ids, list) or len(ids) != len(phones) or any(type(token) is not int or token <= 0 or vocabulary.get(phone) != token for phone, token in zip(phones, ids)):
                raise JobError("Phone references do not match the base vocabulary")
            if name in used or row["id"] in identities or row["audio_sha256"] in hashes:
                raise JobError("Repeated audio or identity in pilot partitions")
            used.add(name); identities.add(row["id"]); hashes.add(row["audio_sha256"])
            speakers.add(str(row["speaker_id"])); seconds += duration
        speaker_sets[split] = speakers
        statistics[split] = {"utterances": len(rows), "hours": seconds / 3600}
    if used != {name for name in manifest["files"] if AUDIO.fullmatch(name)}:
        raise JobError("Bundle contains audio outside the selected manifests")
    if any(speaker_sets[a] & speaker_sets[b] for a, b in (("train", "validation"), ("train", "test"), ("validation", "test"))):
        raise JobError("Speaker leakage across pilot partitions")
    declared = manifest.get("statistics")
    if not isinstance(declared, dict) or set(declared) != set(statistics):
        raise JobError("Bundle statistics do not match the selected manifests")
    for split, measured in statistics.items():
        value = declared[split]
        if (not isinstance(value, dict) or value.get("utterances") != measured["utterances"]
            or type(value.get("hours")) not in (int, float)
            or not math.isclose(value["hours"], measured["hours"], rel_tol=1e-12, abs_tol=1e-12)):
            raise JobError("Bundle statistics do not match the selected manifests")
    return statistics


def child_environment(environ, workspace):
    allowed = {"PATH", "LANG", "LC_ALL", "LD_LIBRARY_PATH", "CUDA_VISIBLE_DEVICES", "NVIDIA_VISIBLE_DEVICES",
               "NVIDIA_DRIVER_CAPABILITIES", "OMP_NUM_THREADS", "MKL_NUM_THREADS", "TMPDIR"}
    result = {key: value for key, value in environ.items() if key in allowed}
    result.update({"PYTHONUNBUFFERED": "1", "PYTHONNOUSERSITE": "1", "HF_HUB_OFFLINE": "1",
                   "TRANSFORMERS_OFFLINE": "1", "HF_HUB_DISABLE_TELEMETRY": "1",
                   "HF_HOME": str(workspace / "offline-hf-home")})
    return result


def signal_process(process, number):
    try:
        if os.name == "posix":
            os.killpg(process.pid, number)
        elif number == signal.SIGTERM:
            process.terminate()
        else:
            process.kill()
    except ProcessLookupError:
        pass


def train(extracted, output, log, environ, max_steps=50, timeout=TRAINING_SECONDS, grace=GRACE_SECONDS,
          popen=subprocess.Popen):
    if type(max_steps) is not int or not 1 <= max_steps <= 50 or not 0 < timeout <= TRAINING_SECONDS or not 0 < grace <= GRACE_SECONDS:
        raise JobError("Pilot exceeds the fixed step or time bound")
    command = [sys.executable, str(extracted / "code/train_english_phoneme.py"),
               "--model", str(extracted / "model"), "--data", str(extracted / "data"),
               "--output", str(output), "--device", "cuda", "--epochs", "1", "--max-steps", str(max_steps),
               "--eval-max-utterances", "32", "--test-max-utterances", "32", "--eval-every", "25",
               "--checkpoint-every", "5"]
    started = time.monotonic()
    with log.open("xb") as handle:
        process = popen(command, cwd=extracted, env=child_environment(environ, extracted.parent),
                        stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)
        timed_out = killed = False
        try:
            code = process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
            signal_process(process, signal.SIGTERM)
            try:
                code = process.wait(timeout=grace)
            except subprocess.TimeoutExpired:
                killed = True
                signal_process(process, signal.SIGKILL)
                code = process.wait(timeout=10)
        except BaseException:
            signal_process(process, signal.SIGKILL)
            process.wait(timeout=10)
            raise
    return {"returncode": code, "timed_out": timed_out, "killed_after_grace": killed,
            "elapsed_seconds": round(time.monotonic() - started, 3), "max_steps": max_steps,
            "soft_timeout_seconds": timeout, "termination_grace_seconds": grace, "device": "cuda"}


def valid_torch_archive(path):
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            return (any(name.endswith("/data.pkl") and archive.getinfo(name).file_size > 0 for name in names)
                    and any(name.endswith("/version") and 0 < archive.getinfo(name).file_size < 100 for name in names)
                    and any("/data/" in name and archive.getinfo(name).file_size > 0 for name in names))
    except (OSError, zipfile.BadZipFile):
        return False


def valid_safetensors(path):
    try:
        with path.open("rb") as handle:
            raw = handle.read(8)
            if len(raw) != 8:
                return False
            length = struct.unpack("<Q", raw)[0]
            if not 2 <= length <= 16 * 1024**2 or length + 8 >= path.stat().st_size:
                return False
            header = json.loads(handle.read(length))
        offsets = []
        for name, item in header.items():
            if name == "__metadata__":
                continue
            if not isinstance(item, dict) or not isinstance(item.get("shape"), list):
                return False
            start, end = item["data_offsets"]
            if type(start) is not int or type(end) is not int or not 0 <= start < end:
                return False
            offsets.append((start, end))
        offsets.sort()
        return bool(offsets) and offsets[0][0] == 0 and all(a[1] == b[0] for a, b in zip(offsets, offsets[1:])) and offsets[-1][1] == path.stat().st_size - 8 - length
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return False


def package_outputs(training, log, stage, outcome):
    stage.mkdir()
    files = {}
    if training.exists():
        for path in training.rglob("*"):
            relative = path.relative_to(training).as_posix()
            if path.is_symlink():
                raise JobError("Output contains a symlink")
            if path.is_dir():
                if relative != "candidate":
                    raise JobError("Unexpected output directory")
                continue
            if relative.endswith(".tmp") and "/" not in relative:
                continue  # Interrupted atomic saves are never exported as checkpoints.
            allowed = relative in OUTPUT_FILES or relative.startswith("candidate/") and relative[10:] in CANDIDATE_FILES
            if not allowed or not stat.S_ISREG(path.stat().st_mode) or path.stat().st_size <= 0:
                raise JobError("Unexpected, empty or nonregular trainer output")
            if path.suffix == ".json":
                object_json(path)
            files["training/" + relative] = path
    if not log.is_file() or log.is_symlink():
        raise JobError("Missing owned trainer log")
    if log.stat().st_size:
        files["trainer.log"] = log
    if sum(path.stat().st_size for path in files.values()) > MAX_OUTPUT_BYTES:
        raise JobError("Pilot artifacts exceed the output bound")
    checkpoint = training / "checkpoint.pt"
    recoverable = checkpoint.is_file() and valid_torch_archive(checkpoint)
    if checkpoint.is_file() and not recoverable:
        raise JobError("Checkpoint is not a structurally valid PyTorch tensor archive")
    weights = [path for name, path in files.items() if name in {"training/candidate/model.safetensors", "training/candidate/pytorch_model.bin"}]
    candidate = bool(len(weights) == 1 and (valid_safetensors(weights[0]) if weights[0].suffix == ".safetensors" else valid_torch_archive(weights[0])))
    if weights and not candidate:
        raise JobError("Candidate weights are not a structurally valid tensor archive")
    completed = outcome["returncode"] == 0 and not outcome["timed_out"]
    if completed:
        result = object_json(training / "result.json")
        if not recoverable or not candidate or result.get("status") != "short_run_complete" or result.get("deployed") is not False:
            raise JobError("Trainer success did not produce a complete undeployed pilot candidate and checkpoint")
        if not all("training/candidate/" + name in files for name in MODEL_FILES):
            raise JobError("Candidate model configuration is incomplete")
    manifest = {"schema_version": 1, "validation": "File allowlist, serialization structure and SHA256; tensors were not loaded here",
                "recoverable_checkpoint": recoverable, "candidate_weights_available": candidate,
                "training_completed": completed, "deployed": False, "onnx_exported": False,
                "resume_note": "Preserve original checkpoint/run-config. Resume requires identical base hashes, data and recipe paths; do not automatically resume under changed paths or settings.",
                "files": {}}
    archive_path = stage / "training-output.tar"
    with tarfile.open(archive_path, "x") as archive:
        for name, path in sorted(files.items()):
            manifest["files"][name] = {"bytes": path.stat().st_size, "sha256": digest(path)}
            archive.add(path, arcname=name, recursive=False)
    manifest.update({"archive_bytes": archive_path.stat().st_size, "archive_sha256": digest(archive_path)})
    write_json(stage / "output-manifest.json", manifest)
    return manifest


def run(args, transport=None, environ=None):
    environ = os.environ if environ is None else environ
    token = require_token(environ)
    input_repo, output_repo = repo_id(args.input_repo), repo_id(args.output_repo)
    if not REVISION.fullmatch(args.input_revision):
        raise JobError("--input-revision must be a full 40-character commit SHA")
    if type(args.max_steps) is not int or not 1 <= args.max_steps <= 50:
        raise JobError("Pilot max-steps must be between 1 and 50")
    transport = HubTransport(token) if transport is None else transport
    private_repo(transport, input_repo, "dataset", args.input_revision)
    private_repo(transport, output_repo, "model")
    run_id = "cloud-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:12]
    remote_folder = "runs/" + run_id
    workspace = Path(args.work_dir) / run_id
    workspace.mkdir(parents=True, exist_ok=False)
    cache = workspace / "download-cache"
    manifest_path = transport.download(input_repo, args.input_revision, "bundle.json", cache)
    manifest = validate_bundle(manifest_path)
    archive = transport.download(input_repo, args.input_revision, "training-input.tar", cache)
    extracted = extract_bundle(archive, manifest, workspace / "input")
    statistics = validate_rows(extracted, manifest)
    plan = {"schema_version": 1, "run_id": run_id, "input_repo": input_repo, "input_revision": args.input_revision,
            "input_archive_sha256": manifest["archive_sha256"], "bundle_manifest_sha256": digest(manifest_path),
            "scope": "pilot", "statistics": statistics, "device": "cuda", "max_steps": args.max_steps,
            "soft_training_timeout_seconds": TRAINING_SECONDS, "termination_grace_seconds": GRACE_SECONDS,
            "deployed": False, "calibrated_pronunciation_grade": False}
    plan_path = workspace / "job-plan.json"; write_json(plan_path, plan)
    private_repo(transport, output_repo, "model")
    transport.upload_file(output_repo, plan_path, remote_folder + "/job-plan.json")
    outcome = train(extracted, workspace / "training", workspace / "trainer.log", environ, max_steps=args.max_steps)
    stage = workspace / "upload"
    artifacts = package_outputs(workspace / "training", workspace / "trainer.log", stage, outcome)
    write_json(stage / "job-result.json", {"schema_version": 1, **plan, "process": outcome,
                                         "recoverable_checkpoint": artifacts["recoverable_checkpoint"],
                                         "candidate_weights_available": artifacts["candidate_weights_available"],
                                         "training_completed": artifacts["training_completed"]})
    shutil.copyfile(plan_path, stage / "job-plan.json")
    private_repo(transport, output_repo, "model")
    transport.upload_folder(output_repo, stage, remote_folder)
    print(json.dumps({"output_repo": output_repo, "path_in_repo": remote_folder, "scope": "pilot",
                      "training_completed": artifacts["training_completed"],
                      "recoverable_checkpoint": artifacts["recoverable_checkpoint"], "deployed": False}))
    return 124 if outcome["timed_out"] else 0 if artifacts["training_completed"] else 1


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-repo", required=True)
    parser.add_argument("--input-revision", required=True, help="Immutable full 40-character input dataset commit SHA")
    parser.add_argument("--output-repo", required=True, help="Pre-created PRIVATE model repository")
    parser.add_argument("--max-steps", type=int, default=50, help="Pilot only: 1 through 50")
    parser.add_argument("--work-dir", type=Path, default=Path(tempfile.gettempdir()) / "egl-cloud-training")
    args = parser.parse_args(argv)
    try:
        return run(args)
    except JobError as error:
        print(str(error), file=sys.stderr)
    except Exception as error:
        # Hub/network/serialization errors may contain URLs or credentials.
        # Never print their message, repr, request, response body or traceback.
        print("Cloud pilot failed (" + type(error).__name__ + "); credentials and provider details omitted", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
