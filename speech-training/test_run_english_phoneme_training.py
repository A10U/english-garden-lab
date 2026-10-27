import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import run_english_phoneme_training as runner


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.args = runner.parse_args([
            "--data", str(self.root / "data"), "--model", str(self.root / "model"),
            "--output", str(self.root / "output"), "--job-dir", str(self.root / "job"),
        ])
        self.preparer = self.root / "prepare.py"
        self.trainer = self.root / "train.py"
        self.preparer.write_text('''import json, sys
from pathlib import Path
data = Path(sys.argv[sys.argv.index('--output') + 1])
data.mkdir(parents=True, exist_ok=True)
(data / 'ready').write_text('verified')
(data / 'prepare-args.json').write_text(json.dumps(sys.argv[1:]))
''')
        self.trainer.write_text('''import json, sys
from pathlib import Path
data = Path(sys.argv[sys.argv.index('--data') + 1])
assert (data / 'ready').read_text() == 'verified'
output = Path(sys.argv[sys.argv.index('--output') + 1])
output.mkdir(parents=True, exist_ok=True)
(output / 'train-args.json').write_text(json.dumps(sys.argv[1:]))
(output / 'result.json').write_text(json.dumps({'status': 'complete'}))
''')

    def tearDown(self):
        self.temporary.cleanup()

    def run_job(self):
        return runner.run_job(self.args, prepare_script=self.preparer, train_script=self.trainer, poll_seconds=.01)

    def status(self):
        return json.loads((self.args.job_dir / "status.json").read_text())

    def test_sequential_full_job_uses_current_python_and_records_real_child_results(self):
        self.assertEqual(self.run_job(), 0)
        state = self.status()
        self.assertEqual(state["status"], "complete")
        self.assertEqual(state["phase"], "finished")
        self.assertEqual(state["returncodes"], {"preparing_data": 0, "training": 0})
        self.assertIsNone(state["child_pid"])
        self.assertFalse(state["deployed"])
        for command in state["commands"].values():
            self.assertEqual(command[0], sys.executable)
            self.assertNotIn("--max-steps", command)
        self.assertEqual(state["commands"]["prepare"][2], "all")
        train_args = json.loads((self.args.output / "train-args.json").read_text())
        self.assertEqual(train_args[train_args.index("--device") + 1], "mps")
        self.assertNotIn("--resume", train_args)
        self.assertFalse((self.args.job_dir / ".job.lock").exists())

    def test_checkpoint_resumes_automatically_and_completed_job_does_not_launch_children(self):
        self.args.output.mkdir()
        (self.args.output / "checkpoint.pt").write_bytes(b"completed-step fixture")
        self.assertEqual(self.run_job(), 0)
        self.assertIn("--resume", self.status()["commands"]["train"])
        prepared = (self.args.data / "prepare-args.json").stat().st_mtime_ns
        with mock.patch.object(runner.subprocess, "Popen", side_effect=AssertionError("completed run must not execute")):
            self.assertEqual(self.run_job(), 0)
        self.assertEqual(self.status()["phase"], "already_complete")
        self.assertTrue(self.status()["skipped_training"])
        self.assertEqual((self.args.data / "prepare-args.json").stat().st_mtime_ns, prepared)

    def test_preparation_failure_never_starts_training_and_short_run_is_not_complete(self):
        self.preparer.write_text("raise SystemExit(7)\n")
        self.assertEqual(self.run_job(), 1)
        self.assertEqual(self.status()["returncodes"], {"preparing_data": 7})
        self.assertFalse(self.args.output.exists())
        self.assertEqual(self.status()["status"], "failed")
        self.args.output.mkdir()
        (self.args.output / "result.json").write_text('{"status":"short_run_complete"}')
        self.assertFalse(runner.training_complete(self.args.output))

    def test_alive_unknown_and_malformed_locks_are_preserved_and_only_dead_pid_is_removed(self):
        lock = self.root / ".download.lock"
        for activity in ("alive", "unknown"):
            lock.write_text("1234")
            with self.assertRaisesRegex(RuntimeError, "cannot be verified dead"):
                runner.clear_dead_lock(lock, probe=lambda _pid: activity)
            self.assertEqual(lock.read_text(), "1234")
        lock.write_text("not a PID")
        with self.assertRaisesRegex(RuntimeError, "verifiable process owner"):
            runner.clear_dead_lock(lock, probe=lambda _pid: "dead")
        self.assertTrue(lock.exists())
        lock.write_text("1234")
        self.assertTrue(runner.clear_dead_lock(lock, probe=lambda _pid: "dead"))
        self.assertFalse(lock.exists())
        lock.symlink_to(self.preparer)
        with self.assertRaisesRegex(RuntimeError, "safely inspect"):
            runner.clear_dead_lock(lock, probe=lambda _pid: "dead")
        self.assertTrue(lock.is_symlink())
        self.assertTrue(self.preparer.is_file())

    def test_permission_denial_and_invalid_pids_are_unknown_not_dead(self):
        with mock.patch.object(runner.os, "kill", side_effect=PermissionError):
            self.assertEqual(runner.process_state(1234), "unknown")
        with mock.patch.object(runner.os, "kill", side_effect=ProcessLookupError):
            self.assertEqual(runner.process_state(1234), "dead")
        self.assertEqual(runner.process_state(-1), "unknown")
        self.assertEqual(runner.process_state(0), "unknown")
        self.assertEqual(runner.process_state(10**40), "unknown")

    def test_duplicate_job_cannot_overwrite_existing_owner_status(self):
        self.args.job_dir.mkdir()
        (self.args.job_dir / "status.json").write_text('{"status":"owner-running"}')
        with runner.exclusive_job_lock(self.args.job_dir / ".job.lock"):
            with self.assertRaisesRegex(RuntimeError, "active or cannot be verified dead"):
                self.run_job()
            self.assertEqual(self.status(), {"status": "owner-running"})

    def test_waiting_downloader_does_not_launch_preparation_early(self):
        self.args.wait_download_pid = 1234
        def waiting(_seconds):
            self.assertEqual(self.status()["phase"], "waiting_download")
            self.assertIsNone(self.status()["child_pid"])
            self.assertFalse(self.args.data.exists())
        with mock.patch.object(runner, "process_state", side_effect=["alive", "dead"]), mock.patch.object(runner.time, "sleep", side_effect=waiting) as sleep:
            self.assertEqual(self.run_job(), 0)
        self.assertEqual(sleep.call_count, 1)

    def test_job_state_and_training_output_cannot_overlap(self):
        self.args.job_dir = self.args.output
        with self.assertRaisesRegex(ValueError, "must be separate"):
            self.run_job()
        self.assertFalse(self.args.output.exists())

    def test_sigterm_is_forwarded_so_trainer_can_save_checkpoint(self):
        self.trainer.write_text('''import json, signal, sys, time
from pathlib import Path
output = Path(sys.argv[sys.argv.index('--output') + 1])
output.mkdir(parents=True, exist_ok=True)
def stop(signum, frame):
    (output / 'checkpoint.pt').write_bytes(b'saved after forwarded signal')
    (output / 'status.json').write_text(json.dumps({'status': 'interrupted'}))
    raise SystemExit(130)
signal.signal(signal.SIGTERM, stop)
(output / 'ready').write_text('signal handler installed')
while True: time.sleep(.05)
''')
        launcher = self.root / "launch.py"
        argv = ["--data", str(self.args.data), "--model", str(self.args.model),
                "--output", str(self.args.output), "--job-dir", str(self.args.job_dir)]
        launcher.write_text("import sys\nsys.path.insert(0, " + repr(str(runner.BASE)) + ")\n"
                            "import run_english_phoneme_training as runner\n"
                            "raise SystemExit(runner.run_job(runner.parse_args(" + repr(argv) + "), prepare_script="
                            "runner.Path(" + repr(str(self.preparer)) + "), train_script=runner.Path(" + repr(str(self.trainer)) + ")))\n")
        process = subprocess.Popen([sys.executable, str(launcher)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            deadline = time.monotonic() + 5
            while not (self.args.output / "ready").exists() and time.monotonic() < deadline:
                if process.poll() is not None:
                    self.fail("Fixture runner exited before training")
                time.sleep(.02)
            self.assertTrue((self.args.output / "ready").is_file())
            process.send_signal(signal.SIGTERM)
            self.assertEqual(process.wait(timeout=5), 128 + signal.SIGTERM)
            self.assertEqual((self.args.output / "checkpoint.pt").read_bytes(), b"saved after forwarded signal")
            self.assertEqual(self.status()["status"], "interrupted")
            self.assertEqual(self.status()["returncodes"]["training"], 130)
            self.assertIsNone(self.status()["child_pid"])
            self.assertFalse((self.args.job_dir / ".job.lock").exists())
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)


if __name__ == "__main__":
    unittest.main()
