"""Run verified LibriSpeech preparation and a full English phoneme training job.

Launch this script with the desired Python environment and redirect its stdout
and stderr to a job log. Child commands inherit that log. This runner never
deploys a model. An existing completed run is left alone; a checkpoint resumes
the same full training command without a short-run step limit.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time


BASE = Path(__file__).resolve().parent
PREPARE_SCRIPT = BASE / "prepare_english_phoneme_data.py"
TRAIN_SCRIPT = BASE / "train_english_phoneme.py"


def process_state(pid: int) -> str:
    """Permission errors are unknown, never proof that a lock owner is dead."""
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        return "unknown"
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return "dead"
    except (PermissionError, OSError, OverflowError):
        return "unknown"
    return "alive"


def clear_dead_lock(path: Path, probe=process_state) -> bool:
    """Remove only an unchanged regular PID lock whose process no longer exists."""
    try:
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    except FileNotFoundError:
        return False
    except OSError as error:
        raise RuntimeError(f"Cannot safely inspect lock: {path}") from error
    try:
        info = os.fstat(descriptor)
        raw = os.read(descriptor, 65)
    finally:
        os.close(descriptor)
    import stat
    if not stat.S_ISREG(info.st_mode) or len(raw) > 64:
        raise RuntimeError(f"Lock is not a regular PID file: {path}")
    try:
        pid = int(raw.decode().strip())
    except (ValueError, UnicodeDecodeError) as error:
        raise RuntimeError(f"Lock has no verifiable process owner: {path}") from error
    if pid <= 0 or probe(pid) != "dead":
        raise RuntimeError(f"Lock owner is active or cannot be verified dead: {path} (PID {pid})")
    try:
        current = path.lstat()
    except FileNotFoundError:
        return False
    if (current.st_dev, current.st_ino, current.st_mtime_ns, current.st_size) != (
        info.st_dev, info.st_ino, info.st_mtime_ns, info.st_size
    ):
        raise RuntimeError(f"Lock changed while checking its owner; left untouched: {path}")
    path.unlink()
    return True


@contextmanager
def exclusive_job_lock(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    for _ in range(3):
        try:
            descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            break
        except FileExistsError:
            clear_dead_lock(path)
    else:
        raise RuntimeError(f"Could not acquire job lock: {path}")
    owner = os.fstat(descriptor)
    try:
        os.write(descriptor, str(os.getpid()).encode())
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    try:
        yield
    finally:
        try:
            current = path.lstat()
            if (current.st_dev, current.st_ino) == (owner.st_dev, owner.st_ino):
                path.unlink()
        except FileNotFoundError:
            pass


def write_status(path: Path, state: dict) -> None:
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    temporary = path.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(state, indent=2, allow_nan=False) + "\n")
    temporary.replace(path)


def training_complete(output: Path) -> bool:
    for name in ("result.json", "status.json"):
        path = output / name
        if path.is_file():
            record = json.loads(path.read_text())
            if record.get("status") == "complete":
                return True
    return False


def validate_paths(args) -> None:
    for name in ("model", "data", "output", "job_dir"):
        setattr(args, name, getattr(args, name).resolve())
    for writable, protected in ((args.output, args.model), (args.output, args.data),
                                (args.job_dir, args.model), (args.job_dir, args.data),
                                (args.job_dir, args.output)):
        if writable.is_relative_to(protected) or protected.is_relative_to(writable):
            raise ValueError("Job state and training output must be separate from each other, model, and dataset")


def run_job(args, *, prepare_script=PREPARE_SCRIPT, train_script=TRAIN_SCRIPT, poll_seconds=5) -> int:
    validate_paths(args)
    # Acquire before writing status so a duplicate cannot overwrite the active
    # owner's progress. Locks survive an abrupt kill and are checked on restart.
    with exclusive_job_lock(args.job_dir / ".job.lock"):
        status_path = args.job_dir / "status.json"
        prepare = [sys.executable, str(prepare_script), "all", "--output", str(args.data), "--model-dir", str(args.model)]
        train = [sys.executable, str(train_script), "--model", str(args.model), "--data", str(args.data),
                 "--device", args.device, "--output", str(args.output)]
        state = {"schema_version": 1, "status": "running", "phase": "starting", "pid": os.getpid(),
                 "child_pid": None, "waiting_download_pid": args.wait_download_pid,
                 "commands": {"prepare": prepare, "train": train}, "returncodes": {},
                 "output": str(args.output), "deployed": False}
        child = None
        stopped = None

        def status(**updates):
            state.update(updates)
            write_status(status_path, state)

        def stop(signum, _frame):
            nonlocal stopped
            stopped = signum
            if child is not None and child.poll() is None:
                try:
                    child.send_signal(signum)
                except ProcessLookupError:
                    pass

        handlers = {signum: signal.signal(signum, stop) for signum in (signal.SIGINT, signal.SIGTERM)}

        def execute(phase, command):
            nonlocal child
            if stopped is not None:
                return None
            print(f"Starting {phase}: {json.dumps(command)}", flush=True)
            child = subprocess.Popen(command, cwd=BASE, stdin=subprocess.DEVNULL)
            if stopped is not None:
                try:
                    child.send_signal(stopped)
                except ProcessLookupError:
                    pass
            status(phase=phase, child_pid=child.pid)
            try:
                code = child.wait()
            finally:
                state["child_pid"] = None
            state["returncodes"][phase] = code
            child = None
            status()
            return code

        try:
            status()
            if training_complete(args.output):
                status(status="complete", phase="already_complete", skipped_training=True)
                return 0
            if args.wait_download_pid is not None:
                status(phase="waiting_download")
                while stopped is None:
                    activity = process_state(args.wait_download_pid)
                    if activity == "dead":
                        break
                    if activity == "unknown":
                        raise RuntimeError("Cannot verify the downloader process; no lock has been removed")
                    time.sleep(poll_seconds)
            if stopped is None:
                clear_dead_lock(args.data / ".download.lock")
                clear_dead_lock(args.data / ".prepare.lock")
                code = execute("preparing_data", prepare)
                if code not in (None, 0):
                    raise RuntimeError(f"Dataset preparation exited with code {code}")
            if stopped is None:
                if (args.output / "checkpoint.pt").is_file():
                    train.append("--resume")
                    status(resuming=True)
                code = execute("training", train)
                if code not in (None, 0):
                    raise RuntimeError(f"Training exited with code {code}")
            if stopped is not None:
                status(status="interrupted", phase="stopped", signal=stopped)
                return 128 + stopped
            if not training_complete(args.output):
                raise RuntimeError("Trainer exited without a complete full-run result; inspect the training status")
            status(status="complete", phase="finished")
            return 0
        except Exception as error:
            status(status="interrupted" if stopped is not None else "failed", phase="stopped" if stopped is not None else "error",
                   error=str(error), signal=stopped)
            print(f"Job stopped: {error}", file=sys.stderr, flush=True)
            return 128 + stopped if stopped is not None else 1
        finally:
            for signum, handler in handlers.items():
                signal.signal(signum, handler)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=BASE / "data/english-phoneme-librispeech")
    parser.add_argument("--model", type=Path, default=BASE / "models/phoneme-ctc")
    parser.add_argument("--output", type=Path, default=BASE / "runs/english-phoneme-librispeech100-v1")
    parser.add_argument("--job-dir", type=Path, default=BASE / "runs/english-phoneme-librispeech100-job")
    parser.add_argument("--device", choices=("mps", "cpu"), default="mps")
    parser.add_argument("--wait-download-pid", type=int)
    args = parser.parse_args(argv)
    if args.wait_download_pid is not None and args.wait_download_pid <= 0:
        parser.error("--wait-download-pid must be positive")
    return args


def main(argv=None):
    try:
        return run_job(parse_args(argv))
    except (OSError, ValueError, RuntimeError) as error:
        print(f"Job could not start: {error}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
