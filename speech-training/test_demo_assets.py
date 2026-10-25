"""Portable demo export checks, using only synthetic fixture WAVs and stdlib."""
from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import wave

from export_demo_assets import SOURCE_SPECS, PUBLIC_PREFIX, export_assets, verify_export, wav_info


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def pcm_fixture():
    result = io.BytesIO()
    with wave.open(result, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        wav.writeframes(b"\x00\x10" * 6000)
    return result.getvalue()


class DemoAssetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.output = self.root / "speech-training/demo-assets"
        training = self.root / "speech-training"
        training.mkdir()
        engine = b"# Synthetic engine fixture; no real model.\n"
        (training / "phonetic_engine.py").write_bytes(engine)
        engine_sha = hashlib.sha256(engine).hexdigest()
        audio = pcm_fixture()
        sha = hashlib.sha256(audio).hexdigest()
        by_audio, by_text, texts, prompts = {}, {}, {}, []
        for variant, location, numbers in SOURCE_SPECS:
            path = self.root / location
            records = []
            for number in numbers:
                ident = f"tts-{number:03d}"
                text = f"Example number {number}."
                source = path.parent / (ident + ".wav")
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_bytes(audio)
                tokens = ["Example", "number", str(number)]
                words = [{"index": index, "text": token, "ipa": "a", "phones": ["a"],
                    "start": index * .07, "end": (index + 1) * .07,
                    "core_start": index * .07, "core_end": (index + 1) * .07}
                    for index, token in enumerate(tokens)]
                text_reference = {"text": text, "ipa": "a a a", "accent": "en-us", "words": words,
                    "analysis_type": "text_pronunciation_reference", "audio_analyzed": False}
                texts[text] = text_reference
                reference = {"text": text, "url": source.relative_to(self.root).as_posix(),
                    "audio_sha256": sha, "duration_seconds": .25, "words": words}
                by_audio[reference["url"]] = reference
                by_text[text] = reference
                analysis = {"reference": text_reference, "observed": {"ipa": "a", "phones": [
                    {"phone": "a", "start": .01, "end": .1}], "duration_seconds": .25},
                    "alignment": {"words": words, "operations": []},
                    "metrics": {"duration_seconds": .25, "rms_dbfs": -18.0, "voiced_seconds": .25},
                    "analysis_type": "acoustic_phone_comparison", "audio_analyzed": True,
                    "limitations": ["Synthetic test fixture, not a learner recording"]}
                cache_id = hashlib.sha256((engine_sha + sha + text).encode()).hexdigest()
                write_json(training / "runs/reference-alignments" / (cache_id + ".json"), analysis)
                records.append({"id": ident, "text": text, "file": source.name, "status": "ok",
                    "may_be_truncated": False, "samples": 6000, "sample_rate": 24000,
                    "duration_seconds": .25, "seed": number, "generation_seconds": .1})
                if variant == "baseline":
                    prompts.append({"id": ident, "text": text, "category": "fixture"})
            write_json(path, {"results": records, "model": "/Users/private/models/secret",
                "adapter": "/home/private/adapter", "reference_audio": "/private/microphone.wav"})
        # Include text-only references, as in the real public demo.
        for index in range(20):
            texts[f"term{index}"] = {"text": f"term{index}", "ipa": "a", "words": [],
                                     "analysis_type": "text_pronunciation_reference", "audio_analyzed": False}
        data = self.root / "speech-training/resources"
        write_json(data / "phonetics.json", {"texts": texts})
        write_json(data / "reference-audio.json", {"by_audio": by_audio, "by_text": by_text})
        write_json(data / "evaluation-prompts.json", {"prompts": prompts})
        write_json(training / "runs/qwen3-hifi92-lora-v1/result.json", {
            "status": "training_completed", "optimizer_steps": 300, "weights_changed": True,
            "naturalness_improved": None, "suggested_adapter": "/Users/private/adapter"})

    def test_export_is_deterministic_complete_and_sanitizes_private_metadata(self):
        first = export_assets(self.root)
        before = {path.relative_to(self.output).as_posix(): path.read_bytes()
                  for path in self.output.rglob("*") if path.is_file()}
        second = export_assets(self.root)
        after = {path.relative_to(self.output).as_posix(): path.read_bytes()
                 for path in self.output.rglob("*") if path.is_file()}
        self.assertEqual(first, second)
        self.assertEqual(before, after)
        self.assertEqual(first["recordings"], 62)
        self.assertEqual(first["pairs"], 24)
        self.assertEqual(first["files_verified"], 64)
        self.assertEqual(first["text_references"], 58)
        payload = json.loads(before["demo-data.json"])
        serialized = before["demo-data.json"].decode()
        for secret in ("/Users/", "/home/", "SDLC/", "speech-training/runs/", "microphone.wav", "models/"):
            self.assertNotIn(secret, serialized)
        self.assertEqual(payload["pairs"][0]["baseline"]["label"], "A")
        self.assertEqual(payload["pairs"][0]["candidate"]["label"], "B")
        for url, analysis in payload["analyses"].items():
            self.assertTrue(url.startswith(PUBLIC_PREFIX + "audio/"))
            self.assertTrue(analysis["precomputed"])
            self.assertFalse(analysis["live_analysis"])
            self.assertEqual(analysis["playback_source"], "prerecorded_ai")
            self.assertTrue(analysis["audio_analyzed"])

    def test_public_verification_requires_no_excluded_authoring_inputs(self):
        export_assets(self.root)
        shutil.rmtree(self.root / "speech-training/resources")
        shutil.rmtree(self.root / "speech-training/runs")
        (self.root / "speech-training/phonetic_engine.py").unlink()
        self.assertEqual(verify_export(self.output)["cached_ai_analyses"], 62)

    def test_changed_audio_is_detected_by_checksums(self):
        export_assets(self.root)
        audio = self.output / "audio/candidate/tts-001.wav"
        audio.write_bytes(audio.read_bytes() + b"corrupted")
        with self.assertRaisesRegex(ValueError, "checksum differs"):
            verify_export(self.output)

    def test_incomplete_source_is_rejected_before_public_files_are_written(self):
        path = self.root / SOURCE_SPECS[0][1]
        metadata = json.loads(path.read_text())
        metadata["results"][0]["may_be_truncated"] = True
        write_json(path, metadata)
        with self.assertRaisesRegex(ValueError, "did not complete cleanly"):
            export_assets(self.root)
        self.assertFalse(self.output.exists())

    def test_private_path_in_cached_analysis_fails_closed(self):
        cache_file = next((self.root / "speech-training/runs/reference-alignments").glob("*.json"))
        value = json.loads(cache_file.read_text())
        value["reference"]["private_path"] = "/Users/private/voice.wav"
        write_json(cache_file, value)
        with self.assertRaisesRegex(ValueError, "Nonportable/private path"):
            export_assets(self.root)

    def test_wrong_wav_header_does_not_become_a_demo_recording(self):
        with self.assertRaisesRegex(ValueError, "complete RIFF"):
            wav_info(b"not audio")
        data = bytearray(pcm_fixture())
        data[4:8] = (0).to_bytes(4, "little")
        with self.assertRaisesRegex(ValueError, "RIFF length"):
            wav_info(bytes(data))


if __name__ == "__main__":
    unittest.main(verbosity=2)
