"""Cloud boundary regressions; all credentials/transports are fake and local."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
from types import SimpleNamespace
import unittest

import cloud_train_job as job
import manage_cloud_training as control


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_key_loader_reads_only_hf_assignment_and_rejects_empty_or_unsafe_file(self):
        path = self.root / ".env.speech-training"
        fake = "hf_" + "a" * 32
        path.write_text("# fake fixture\nHF_TOKEN=" + fake + "\n"); path.chmod(0o600)
        self.assertEqual(control.read_token(path), fake)
        path.chmod(0o644)
        with self.assertRaises(control.ControlError): control.read_token(path)
        path.chmod(0o600); path.write_text("OPENAI_API_KEY=fake-unused\nHF_TOKEN=\n")
        with self.assertRaises(control.ControlError): control.read_token(path)
        link = self.root / "link"; link.symlink_to(path)
        with self.assertRaises(OSError): control.read_token(link)

    def test_price_changes_and_nonfinite_prices_abort_before_submission(self):
        for price, unit in ((.02, "minute"), (float("nan"), "minute"), (.01, "hour"), (0, "minute")):
            api = SimpleNamespace(list_jobs_hardware=lambda: [SimpleNamespace(name=control.FLAVOR, unit_cost_usd=price, unit_label=unit)])
            with self.assertRaises(control.ControlError): control.price_guard(api)
        api = SimpleNamespace(list_jobs_hardware=lambda: [SimpleNamespace(name=control.FLAVOR, unit_cost_usd=.016667, unit_label="minute")])
        self.assertAlmostEqual(control.price_guard(api)["maximum_compute_estimate_usd"], .50001)

    def api(self, fail=False):
        calls = []
        def run(*args, **kwargs):
            calls.append(kwargs)
            if fail: raise RuntimeError("simulated connection lost after submission")
            return SimpleNamespace(id="fake-job-123", url="https://huggingface.co/jobs/fake/fake-job-123")
        return SimpleNamespace(repo_info=lambda *args, **kwargs: SimpleNamespace(private=True),
                               list_jobs_hardware=lambda: [SimpleNamespace(name=control.FLAVOR, unit_cost_usd=.016667, unit_label="minute")],
                               run_uv_job=run), calls

    def state(self):
        path = self.root / "control.json"
        control.save_state({"schema_version": 1, "phase": "prepared", "job_id": None,
                            "owner": "fake", "input_repo": "fake/input", "output_repo": "fake/output",
                            "input_revision": "a" * 40}, path)
        return path

    def test_ambiguous_launch_is_never_automatically_retried(self):
        api, calls = self.api(fail=True); path = self.state()
        with self.assertRaises(RuntimeError): control.launch(api, "fake-token", path)
        self.assertEqual(control.load_state(path)["phase"], "launching")
        with self.assertRaises(control.ControlError): control.launch(api, "fake-token", path)
        self.assertEqual(len(calls), 1)
        self.assertNotIn("fake-token", path.read_text())

    def test_launch_is_single_attempt_with_remote_secret_and_external_timeout(self):
        api, calls = self.api(); path = self.state()
        result = control.launch(api, "fake-secret", path)
        self.assertEqual(result["phase"], "submitted")
        request = calls[0]
        self.assertEqual((request["attempts"], request["timeout"], request["flavor"]), (1, "30m", "a10g-small"))
        self.assertEqual(request["secrets"], {"HF_TOKEN": "fake-secret"})
        self.assertNotIn("fake-secret", path.read_text())
        with self.assertRaises(control.ControlError): control.launch(api, "fake-secret", path)

    def test_public_repository_and_moving_input_revision_are_rejected(self):
        public = SimpleNamespace(info=lambda *args: SimpleNamespace(private=False, sha="a" * 40))
        with self.assertRaises(job.JobError): job.private_repo(public, "fake/input", "dataset", "a" * 40)
        stale = SimpleNamespace(info=lambda *args: SimpleNamespace(private=True, sha="b" * 40))
        with self.assertRaises(job.JobError): job.private_repo(stale, "fake/input", "dataset", "a" * 40)

    def archive(self, entries):
        path = self.root / "input.tar"
        with tarfile.open(path, "w") as tar:
            for name, content in entries:
                item = tarfile.TarInfo(name); item.size = len(content)
                tar.addfile(item, io.BytesIO(content))
        return path, {"archive_bytes": path.stat().st_size, "archive_sha256": job.digest(path),
                      "files": {name: {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()} for name, content in entries}}

    def test_verified_files_extract_without_executing_or_following_archive_paths(self):
        name = "code/train_english_phoneme.py"
        archive, manifest = self.archive([(name, b"# not executed")])
        destination = job.extract_bundle(archive, manifest, self.root / "ok")
        self.assertEqual((destination / name).read_bytes(), b"# not executed")
        self.assertFalse((self.root / "escaped").exists())

    def test_traversal_duplicate_unlisted_and_tampered_inputs_are_rejected(self):
        for number, entries in enumerate(([('../escaped', b'no')], [('code/train_english_phoneme.py', b'a'), ('code/train_english_phoneme.py', b'b')])):
            archive, manifest = self.archive(entries)
            destination = self.root / ("bad" + str(number))
            with self.assertRaises(job.JobError): job.extract_bundle(archive, manifest, destination)
            self.assertFalse(destination.exists())
        archive, manifest = self.archive([("code/train_english_phoneme.py", b"data")])
        manifest["files"]["code/train_english_phoneme.py"]["sha256"] = "0" * 64
        with self.assertRaises(job.JobError): job.extract_bundle(archive, manifest, self.root / "tampered")

    def test_no_cloud_credentials_reach_training_child(self):
        env = job.child_environment({"PATH": "/usr/bin", "HF_TOKEN": "fake", "OPENAI_API_KEY": "fake2", "HOME": "/secret"}, self.root)
        self.assertEqual(env["HF_HUB_OFFLINE"], "1")
        self.assertNotIn("HF_TOKEN", env); self.assertNotIn("OPENAI_API_KEY", env); self.assertNotIn("HOME", env)

    def test_actual_child_timeout_stops_process_without_restarting_it(self):
        extracted = self.root / "input"; (extracted / "code").mkdir(parents=True)
        (extracted / "code/train_english_phoneme.py").write_text("import time\ntime.sleep(20)\n")
        outcome = job.train(extracted, self.root / "run", self.root / "log", {}, timeout=.1, grace=.2)
        self.assertTrue(outcome["timed_out"]); self.assertNotEqual(outcome["returncode"], 0)
        self.assertLess(outcome["elapsed_seconds"], 3)

    def test_unavailable_candidate_cannot_be_called_success(self):
        training = self.root / "run"; training.mkdir()
        log = self.root / "log"; log.write_text("test fixture")
        (training / "result.json").write_text(json.dumps({"status": "short_run_complete", "deployed": False}))
        with self.assertRaises(job.JobError):
            job.package_outputs(training, log, self.root / "upload", {"returncode": 0, "timed_out": False})


if __name__ == "__main__":
    unittest.main()
