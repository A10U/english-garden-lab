"""Public-corpus bundle boundary tests; no network, secrets, or real training."""
import hashlib
import json
from pathlib import Path
import tarfile
import tempfile
import unittest

from package_cloud_training import MODEL_FILES, SPLITS, package


class CloudBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.model = self.root / "model"; self.model.mkdir()
        for filename in MODEL_FILES:
            (self.model / filename).write_text(json.dumps({"<pad>": 0, "w": 1}) if filename == "vocab.json" else "{}")
        (self.model / "model.safetensors").write_bytes(b"dummy model for bundle IO tests, never loaded")
        self.data = self.root / "data"; self.data.mkdir()
        self.rows = {}
        for number, (split, source) in enumerate(SPLITS.items(), 1):
            relative = f"sources/{source}/LibriSpeech/{source}/{number}/10/{number}-10-0000.flac"
            audio = self.data / relative; audio.parent.mkdir(parents=True); audio.write_bytes(b"public-fixture-" + bytes([number]))
            row = {"id": f"{number}-10-0000", "text": "water", "audio": relative, "speaker_id": str(number),
                   "sample_rate_hz": 16000, "duration_seconds": 1, "split": split, "phones": ["w"], "phone_ids": [1],
                   "label_source": "canonical_espeak", "label_kind": "canonical_text_reference", "human_reviewed": False,
                   "audio_sha256": hashlib.sha256(audio.read_bytes()).hexdigest()}
            self.rows[split] = row
        self.write_rows()

    def write_rows(self):
        for split, row in self.rows.items():
            (self.data / (split + ".jsonl")).write_text(json.dumps(row) + "\n")

    def test_only_explicit_corpus_and_model_files_are_packaged(self):
        (self.root / ".env.speech-cloud").write_text("FAKE_SECRET_MUST_NOT_BE_INCLUDED")
        (self.model / "unrelated.txt").write_text("not included")
        (self.data / "private.wav").write_bytes(b"private")
        output = self.root / "bundle"
        manifest = package(self.model, self.data, output)
        with tarfile.open(output / "training-input.tar") as tar:
            names = tar.getnames()
            self.assertEqual(set(names), set(manifest["files"]))
            self.assertFalse(any(".env" in name or "private" in name or "unrelated" in name for name in names))
            for member in tar:
                content = tar.extractfile(member).read()
                self.assertEqual(hashlib.sha256(content).hexdigest(), manifest["files"][member.name]["sha256"])
                self.assertEqual(len(content), manifest["files"][member.name]["bytes"])
                self.assertNotIn(b"FAKE_SECRET_MUST_NOT_BE_INCLUDED", content)
        self.assertFalse(manifest["private_audio"])
        self.assertEqual(manifest["statistics"]["train"]["utterances"], 1)
        self.assertEqual(hashlib.sha256((output / "training-input.tar").read_bytes()).hexdigest(), manifest["archive_sha256"])

    def test_existing_bundle_is_never_overwritten(self):
        output = self.root / "existing"; output.mkdir()
        sentinel = output / "keep.txt"; sentinel.write_text("keep")
        with self.assertRaises(ValueError):
            package(self.model, self.data, output)
        self.assertEqual(sentinel.read_text(), "keep")

    def test_contained_noncorpus_audio_is_rejected(self):
        audio = self.data / "recording.wav"; audio.write_bytes(b"private")
        self.rows["train"]["audio"] = audio.name
        self.rows["train"]["audio_sha256"] = hashlib.sha256(audio.read_bytes()).hexdigest()
        self.write_rows()
        with self.assertRaisesRegex(ValueError, "official LibriSpeech"):
            package(self.model, self.data, self.root / "bundle")

    def test_tampered_corpus_audio_cannot_be_uploaded_as_verified_data(self):
        (self.data / self.rows["train"]["audio"]).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "checksum"):
            package(self.model, self.data, self.root / "bundle")

    def test_corpus_symlink_is_rejected(self):
        audio = self.data / self.rows["train"]["audio"]
        content = audio.read_bytes(); audio.unlink()
        other = self.root / "other.flac"; other.write_bytes(content); audio.symlink_to(other)
        with self.assertRaises(ValueError):
            package(self.model, self.data, self.root / "bundle")

    def test_no_manifest_can_reuse_a_speaker_from_another_split(self):
        self.rows["validation"]["speaker_id"] = self.rows["train"]["speaker_id"]
        self.write_rows()
        with self.assertRaisesRegex(ValueError, "overlap|leakage"):
            package(self.model, self.data, self.root / "bundle")


if __name__ == "__main__":
    unittest.main()
