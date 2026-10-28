"""Opt-in Hugging Face pilot controls. Never reads the OpenAI key file.

prepare uploads the explicit public input bundle to new private repositories.
launch submits one 30-minute A10G job, once, after checking current pricing.
status/download operate only on the recorded job and owned result repository.
No automatic launch retry, model deployment, or full 100-hour cloud run.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
from pathlib import Path
import re
import stat
import sys
import uuid

ROOT = Path(__file__).resolve().parent.parent
TOKEN_FILE = ROOT / ".env.speech-training"
STATE = ROOT / "outputs/hf-training-pilot/control.json"
BUNDLE = ROOT / ".build/hf-training-pilot"
FLAVOR = "a10g-small"
TIMEOUT = "30m"


class ControlError(ValueError):
    pass


def read_token(path=TOKEN_FILE):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > 4096:
            raise ControlError("Training token file must be a regular 0600 file under 4 KiB")
        content = os.read(descriptor, 4097).decode("utf-8")
    finally:
        os.close(descriptor)
    values = [line.split("=", 1)[1].strip().strip('\"\'') for line in content.splitlines()
              if re.match(r"^HF_TOKEN\s*=", line)]
    if len(values) != 1 or not re.fullmatch(r"hf_[A-Za-z0-9]{20,509}", values[0]):
        raise ControlError("Set exactly one new HF_TOKEN in .env.speech-training")
    return values[0]


def save_state(state, path=STATE):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as handle:
        json.dump(state, handle, indent=2, ensure_ascii=False, allow_nan=False)
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def load_state(path=STATE):
    state = json.loads(path.read_text())
    if not isinstance(state, dict) or state.get("schema_version") != 1:
        raise ControlError("Invalid local pilot control state")
    return state


def price_guard(api):
    hardware = next((item for item in api.list_jobs_hardware() if item.name == FLAVOR), None)
    price = getattr(hardware, "unit_cost_usd", None)
    if hardware is None or hardware.unit_label != "minute" or type(price) not in (int, float) or not math.isfinite(price) or not 0 < price <= 1.01 / 60:
        raise ControlError("A10G pricing changed or is unavailable; no job was submitted")
    return {"flavor": FLAVOR, "timeout": TIMEOUT, "attempts": 1,
            "price_usd_per_minute": price, "maximum_compute_estimate_usd": round(price * 30, 6)}


def private(api, repo, kind):
    info = api.repo_info(repo, repo_type=kind)
    if getattr(info, "private", None) is not True:
        raise ControlError("Pilot repository must remain private")
    return info


def prepare(api, state_path=STATE, bundle=BUNDLE):
    from cloud_train_job import validate_bundle, digest
    if state_path.exists():
        raise ControlError("A pilot control state already exists; inspect it instead of creating duplicate resources")
    manifest = validate_bundle(bundle / "bundle.json")
    archive = bundle / "training-input.tar"
    if archive.stat().st_size != manifest["archive_bytes"] or digest(archive) != manifest["archive_sha256"]:
        raise ControlError("Pilot input archive changed")
    cost = price_guard(api)
    identity = api.whoami()
    owner = identity.get("name", "")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,95}", owner):
        raise ControlError("Could not determine the authenticated Hugging Face namespace")
    suffix = uuid.uuid4().hex[:10]
    state = {"schema_version": 1, "phase": "preparing", "owner": owner,
             "input_repo": owner + "/egl-speech-pilot-input-" + suffix,
             "output_repo": owner + "/egl-speech-pilot-model-" + suffix,
             "scope": "pilot", "cost": cost, "deployed": False, "job_id": None}
    save_state(state, state_path)
    api.create_repo(state["input_repo"], repo_type="dataset", private=True, exist_ok=False)
    api.create_repo(state["output_repo"], repo_type="model", private=True, exist_ok=False)
    private(api, state["input_repo"], "dataset"); private(api, state["output_repo"], "model")
    commit = api.upload_folder(repo_id=state["input_repo"], repo_type="dataset", folder_path=str(bundle),
                               allow_patterns=["bundle.json", "training-input.tar"],
                               commit_message="Verified public LibriSpeech pilot input")
    revision = str(commit.oid)
    if not re.fullmatch(r"[a-fA-F0-9]{40}", revision):
        raise ControlError("Input upload did not return an immutable full commit SHA")
    state.update(phase="prepared", input_revision=revision, archive_sha256=manifest["archive_sha256"],
                 statistics=manifest["statistics"])
    save_state(state, state_path)
    return {"phase": state["phase"], "private_repositories": True, "scope": "pilot", "cost": cost}


def launch(api, token, state_path=STATE):
    state = load_state(state_path)
    if state["phase"] != "prepared" or state.get("job_id"):
        raise ControlError("Launch is one-shot; inspect existing or ambiguous job state before any retry")
    private(api, state["input_repo"], "dataset"); private(api, state["output_repo"], "model")
    cost = price_guard(api)
    # Persist before the side effect: a lost API response must never trigger an
    # automatic second paid job. Inspect the HF Jobs page if this stays here.
    state.update(phase="launching", cost=cost)
    save_state(state, state_path)
    try:
        job = api.run_uv_job(str(ROOT / "speech-training/cloud_train_job.py"),
                             script_args=["--input-repo", state["input_repo"], "--input-revision", state["input_revision"],
                                          "--output-repo", state["output_repo"]],
                             python="3.12", flavor=FLAVOR, timeout=TIMEOUT, attempts=1,
                             secrets={"HF_TOKEN": token}, name="english-garden-speech-pilot")
    except Exception as error:
        response = getattr(error, "response", None)
        code = getattr(response, "status_code", None)
        category = "unknown"
        # Classify without printing or saving arbitrary server bodies.
        try:
            message = json.dumps(response.json()).lower() if response is not None else ""
            if "credit" in message or "balance" in message: category = "credit_balance"
            elif "permission" in message or "scope" in message: category = "token_permission"
            elif "label" in message or "name" in message: category = "job_label"
            elif "hardware" in message or "flavor" in message: category = "hardware"
        except Exception:
            pass
        state["submission_error"] = {"http_status": code if type(code) is int else None, "category": category}
        save_state(state, state_path)
        raise
    state.update(phase="submitted", job_id=job.id, job_url=job.url)
    save_state(state, state_path)
    return {"phase": "submitted", "job_id": job.id, "url": job.url, "cost": cost}


def status(api, state_path=STATE):
    state = load_state(state_path)
    if not state.get("job_id"):
        return {"phase": state["phase"], "job_submitted": False}
    job = api.inspect_job(job_id=state["job_id"], namespace=state["owner"])
    value = job.status
    stage = getattr(value, "stage", str(value))
    state["remote_stage"] = stage
    save_state(state, state_path)
    return {"job_id": state["job_id"], "stage": stage, "url": state.get("job_url"), "cost": state["cost"]}


def download(api, token, state_path=STATE):
    from huggingface_hub import snapshot_download
    state = load_state(state_path)
    private(api, state["output_repo"], "model")
    destination = state_path.parent / "model-result"
    snapshot_download(repo_id=state["output_repo"], repo_type="model", token=token,
                      local_dir=destination, allow_patterns=["runs/cloud-*/job-plan.json", "runs/cloud-*/job-result.json",
                                                           "runs/cloud-*/output-manifest.json", "runs/cloud-*/training-output.tar"])
    return {"downloaded_to": str(destination), "deployed": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "launch", "status", "download"))
    args = parser.parse_args()
    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
    for name in ("huggingface_hub", "httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.CRITICAL)
    try:
        token = read_token()
        from huggingface_hub import HfApi
        from huggingface_hub.utils import disable_progress_bars
        disable_progress_bars()
        api = HfApi(endpoint="https://huggingface.co", token=token)
        functions = {"prepare": lambda: prepare(api), "launch": lambda: launch(api, token),
                     "status": lambda: status(api), "download": lambda: download(api, token)}
        print(json.dumps(functions[args.action](), ensure_ascii=False, allow_nan=False))
        return 0
    except ControlError as error:
        print(str(error), file=sys.stderr)
    except Exception as error:
        code = getattr(getattr(error, "response", None), "status_code", None)
        print("Cloud action failed (" + type(error).__name__ + (", HTTP " + str(code) if type(code) is int else "") + "); credential/provider details omitted", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
