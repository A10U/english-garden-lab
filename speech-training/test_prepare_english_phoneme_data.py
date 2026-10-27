"""Real downloader/extractor/manifest invariants with bounded local fixtures."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

from prepare_english_phoneme_data import (
    build_manifests, canonical_labeler, DEFAULT_MODEL, download_archive, extract_archive,
    inspect_audio, load_config, transcript_records,
)


class Response(io.BytesIO):
    def __init__(self, content, *, status=200, headers=None, fail_after_first=False):
        super().__init__(content)
        self.status = status
        self.headers = headers if headers is not None else {"Content-Length": str(len(content))}
        self.fail_after_first = fail_after_first
        self.reads = 0

    def read(self, size=-1):
        self.reads += 1
        if self.fail_after_first and self.reads > 1:
            raise urllib.error.URLError("fixture disconnect")
        return super().read(size)


class EnglishPhonemePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def spec(self, data, source_split="train-clean-100"):
        return {"archive": source_split + ".tar.gz", "source_split": source_split,
                "md5": hashlib.md5(data).hexdigest(), "max_archive_bytes": 1024 * 1024}

    def archive(self, members, source_split="train-clean-100"):
        output = self.root / (source_split + ".tar.gz")
        with tarfile.open(output, "w:gz") as bundle:
            for name, value in members:
                member = tarfile.TarInfo(name)
                if isinstance(value, tuple):
                    member.type, member.linkname = value
                    bundle.addfile(member)
                elif value is None:
                    member.type = tarfile.DIRTYPE
                    bundle.addfile(member)
                else:
                    member.size = len(value)
                    bundle.addfile(member, io.BytesIO(value))
        return output, self.spec(output.read_bytes(), source_split)

    def test_pinned_configuration_selects_full_100h_and_official_heldouts(self):
        config = load_config()
        self.assertEqual(config["splits"]["train"]["source_split"], "train-clean-100")
        self.assertEqual(config["splits"]["validation"]["md5"], "42e2234ba48799c1f50f24a7926300a1")
        self.assertEqual(config["splits"]["test"]["md5"], "32fa31d27d2e1cad72775fee3f4849a9")
        self.assertFalse(config["labels"]["human_reviewed"])
        self.assertEqual(config["labels"]["kind"], "canonical_text_reference")

    def test_download_checks_official_digest_before_publish_and_reuses_verified_file(self):
        data = b"verified complete source archive"
        spec = self.spec(data)
        def opener(request, timeout):
            self.assertFalse((self.root / spec["archive"]).exists())
            self.assertEqual(timeout, 30)
            self.assertIsNone(request.get_header("Range"))
            return Response(data)
        result = download_archive(spec, self.root, "https://example.test/12/", opener=opener)
        self.assertEqual(result["sha256"], hashlib.sha256(data).hexdigest())
        self.assertEqual((self.root / spec["archive"]).read_bytes(), data)
        self.assertFalse((self.root / (spec["archive"] + ".part")).exists())
        download_archive(spec, self.root, "https://example.test/12/", opener=lambda *_args, **_kwargs: self.fail("Unexpected redownload"))

    def test_partial_download_resumes_only_matching_range(self):
        data = b"abcdefghij"
        spec = self.spec(data)
        (self.root / (spec["archive"] + ".part")).write_bytes(data[:3])
        def opener(request, timeout):
            self.assertEqual(request.get_header("Range"), "bytes=3-")
            return Response(data[3:], status=206, headers={"Content-Range": "bytes 3-9/10", "Content-Length": "7"})
        download_archive(spec, self.root, "https://example.test/", opener=opener)
        self.assertEqual((self.root / spec["archive"]).read_bytes(), data)

    def test_ignored_range_restarts_instead_of_appending_duplicate_bytes(self):
        data = b"abcdefghij"
        spec = self.spec(data)
        (self.root / (spec["archive"] + ".part")).write_bytes(data[:3])
        download_archive(spec, self.root, "https://example.test/", opener=lambda *_a, **_k: Response(data))
        self.assertEqual((self.root / spec["archive"]).read_bytes(), data)

    def test_wrong_resume_range_preserves_partial_and_never_publishes(self):
        data = b"abcdefghij"
        spec = self.spec(data)
        partial = self.root / (spec["archive"] + ".part")
        partial.write_bytes(data[:3])
        with self.assertRaisesRegex(ValueError, "incorrect resume range"):
            download_archive(spec, self.root, "https://example.test/", opener=lambda *_a, **_k: Response(data[4:], status=206, headers={"Content-Range": "bytes 4-9/10"}))
        self.assertEqual(partial.read_bytes(), data[:3])
        self.assertFalse((self.root / spec["archive"]).exists())

    def test_connection_interruption_retries_from_persisted_offset(self):
        data = b"abcdefghij"
        spec = self.spec(data)
        requests = []
        def opener(request, timeout):
            requests.append(request.get_header("Range"))
            if len(requests) == 1:
                return Response(data[:4], headers={"Content-Length": "10"}, fail_after_first=True)
            return Response(data[4:], status=206, headers={"Content-Range": "bytes 4-9/10", "Content-Length": "6"})
        download_archive(spec, self.root, "https://example.test/", opener=opener, retry_delay=0)
        self.assertEqual(requests, [None, "bytes=4-"])
        self.assertEqual((self.root / spec["archive"]).read_bytes(), data)

    def test_checksum_mismatch_and_oversized_response_cannot_publish(self):
        spec = self.spec(b"correct bytes")
        with self.assertRaisesRegex(ValueError, "MD5 mismatch"):
            download_archive(spec, self.root, "https://example.test/", opener=lambda *_a, **_k: Response(b"corrupt bytes"))
        self.assertFalse((self.root / spec["archive"]).exists())
        self.assertFalse((self.root / (spec["archive"] + ".part")).exists())
        with self.assertRaisesRegex(ValueError, "size exceeds"):
            download_archive(spec, self.root, "https://example.test/", opener=lambda *_a, **_k: Response(b"", headers={"Content-Length": str(spec["max_archive_bytes"] + 1)}))
        self.assertFalse((self.root / spec["archive"]).exists())

    def test_symlinked_partial_is_never_written(self):
        spec = self.spec(b"abc")
        target = self.root / "private"
        target.write_bytes(b"preserve")
        (self.root / (spec["archive"] + ".part")).symlink_to(target)
        with self.assertRaisesRegex(ValueError, "regular file"):
            download_archive(spec, self.root, "https://example.test/")
        self.assertEqual(target.read_bytes(), b"preserve")

    def test_valid_tar_is_extracted_atomically_and_verified_extraction_reused(self):
        archive, spec = self.archive([
            ("LibriSpeech", None), ("LibriSpeech/train-clean-100", None),
            ("LibriSpeech/LICENSE.TXT", b"official attribution"),
            ("LibriSpeech/train-clean-100/19/198/19-198.trans.txt", b"19-198-0000 HELLO WORLD\n"),
            ("LibriSpeech/train-clean-100/19/198/19-198-0000.flac", b"audio fixture"),
        ])
        extracted = extract_archive(archive, spec, self.root / "sources")
        self.assertEqual((extracted / "LibriSpeech/LICENSE.TXT").read_bytes(), b"official attribution")
        self.assertEqual(extract_archive(archive, spec, self.root / "sources"), extracted)
        rows = transcript_records(extracted, "train-clean-100")
        self.assertEqual(rows[0]["speaker_id"], "19")
        self.assertEqual(rows[0]["chapter_id"], "198")
        self.assertEqual(rows[0]["text"], "HELLO WORLD")
        self.assertFalse(list((self.root / "sources").glob(".extract-*")))

    def test_unsafe_tar_paths_links_and_wrong_split_are_rejected_before_extraction(self):
        cases = [
            ("../outside", b"evil"), ("/absolute", b"evil"),
            ("LibriSpeech/../../outside", b"evil"), ("LibriSpeech\\outside", b"evil"),
            ("LibriSpeech/train-clean-100/link", (tarfile.SYMTYPE, "../../outside")),
            ("LibriSpeech/train-clean-100/link", (tarfile.LNKTYPE, "LibriSpeech/LICENSE.TXT")),
            ("LibriSpeech/test-clean/123.flac", b"wrong split"),
        ]
        for member in cases:
            with self.subTest(member=member):
                archive, spec = self.archive([member])
                with self.assertRaises(ValueError):
                    extract_archive(archive, spec, self.root / "sources")
                self.assertFalse((self.root / "sources/train-clean-100").exists())
                self.assertFalse((self.root / "outside").exists())

    def test_duplicate_tar_paths_and_unpacked_size_bomb_are_rejected(self):
        archive, spec = self.archive([("LibriSpeech/LICENSE.TXT", b"a"), ("LibriSpeech/LICENSE.TXT", b"b")])
        with self.assertRaisesRegex(ValueError, "Duplicate archive"):
            extract_archive(archive, spec, self.root / "sources")
        archive, spec = self.archive([("LibriSpeech/LICENSE.TXT", b"abcd")])
        with patch("prepare_english_phoneme_data.MAX_EXTRACTED_BYTES", 3):
            with self.assertRaisesRegex(ValueError, "size exceeds"):
                extract_archive(archive, spec, self.root / "sources")

    def test_orphaned_audio_is_rejected_instead_of_silently_dropping_inventory(self):
        base = self.root / "LibriSpeech/train-clean-100/19/198"
        base.mkdir(parents=True)
        (base / "19-198.trans.txt").write_text("19-198-0000 HELLO\n")
        (base / "19-198-0000.flac").write_bytes(b"a")
        (base / "19-198-0001.flac").write_bytes(b"b")
        with self.assertRaisesRegex(ValueError, "inventory differs"):
            transcript_records(self.root, "train-clean-100")

    def records(self):
        return {split: [{"id": f"{index}-10-0000", "speaker_id": str(index), "chapter_id": "10", "text": text, "path": self.root / (split + ".flac")}]
                for index, (split, text) in enumerate((("train", "TRAIN WORD"), ("validation", "VALID WORD"), ("test", "TEST WORD")), 1)}

    def audio_info(self, path, output, split, identifier):
        return {"audio": "sources/" + identifier + ".flac", "audio_sha256": hashlib.sha256(identifier.encode()).hexdigest(),
                "sample_rate_hz": 16000, "duration_seconds": 1.25, "frames": 20000}

    @staticmethod
    def label(text):
        return ["t", "ɛ", "s", "t"], [6, 19, 5, 6]

    def test_manifests_preserve_partitions_model_ids_and_explicit_canonical_status(self):
        summary = build_manifests(self.records(), self.root, self.label, self.audio_info)
        self.assertEqual(summary["train"]["count"], 1)
        row = json.loads((self.root / "train.jsonl").read_text())
        self.assertEqual(row["phone_ids"], [6, 19, 5, 6])
        self.assertEqual(row["split"], "train")
        self.assertEqual(row["label_source"], "canonical_espeak")
        self.assertEqual(row["label_kind"], "canonical_text_reference")
        self.assertFalse(row["human_reviewed"])
        self.assertNotIn("path", row)
        self.assertFalse(Path(row["audio"]).is_absolute())

    def test_speaker_leakage_fails_before_any_manifest_is_replaced(self):
        records = self.records()
        records["train"][0]["speaker_id"] = records["test"][0]["speaker_id"]
        (self.root / "train.jsonl").write_text("previous result\n")
        with self.assertRaisesRegex(ValueError, "Speaker leakage"):
            build_manifests(records, self.root, self.label, self.audio_info)
        self.assertEqual((self.root / "train.jsonl").read_text(), "previous result\n")

    def test_heldout_transcript_and_audio_duplicates_are_excluded_with_counts(self):
        records = self.records()
        records["train"].extend([
            {**records["train"][0], "id": "1-10-0001", "text": "test word!"},
            {**records["train"][0], "id": "1-10-0002", "text": "A DIFFERENT TRANSCRIPT"},
        ])
        def inspector(path, output, split, identifier):
            info = self.audio_info(path, output, split, identifier)
            if identifier == "1-10-0002":
                info["audio_sha256"] = self.audio_info(path, output, "test", "3-10-0000")["audio_sha256"]
            return info
        summary = build_manifests(records, self.root, self.label, inspector)
        self.assertEqual(summary["train"]["count"], 1)
        self.assertEqual(summary["train"]["rejected"], {"duplicate_transcript": 1, "duplicate_audio": 1})

    def test_oov_exclusion_is_reported_and_strict_mode_preserves_previous_manifests(self):
        records = self.records()
        records["train"].append({**records["train"][0], "id": "1-10-0001", "text": "OOV WORD"})
        def label(text):
            if text.startswith("OOV"):
                raise ValueError("Out-of-vocabulary canonical phones: ɥ")
            return self.label(text)
        summary = build_manifests(records, self.root, label, self.audio_info)
        self.assertEqual(summary["train"]["rejected"], {"canonical_phone_oov": 1})
        previous = {split: (self.root / (split + ".jsonl")).read_bytes() for split in records}
        with self.assertRaisesRegex(ValueError, "Out-of-vocabulary"):
            build_manifests(records, self.root, label, self.audio_info, oov_policy="fail")
        self.assertEqual(previous, {split: (self.root / (split + ".jsonl")).read_bytes() for split in records})

    @unittest.skipUnless(importlib.util.find_spec("transformers") and (DEFAULT_MODEL / "vocab.json").is_file(), "Local optional phoneme tokenizer is unavailable")
    def test_real_local_tokenizer_labels_match_current_model_inventory(self):
        phones, ids = canonical_labeler(DEFAULT_MODEL)("It's good to see you.")
        vocabulary = json.loads((DEFAULT_MODEL / "vocab.json").read_text())
        self.assertEqual(phones[:3], ["ɪ", "t", "s"])
        self.assertEqual(ids, [vocabulary[phone] for phone in phones])
        self.assertTrue(all(value > 0 for value in ids))

    @unittest.skipUnless(all(importlib.util.find_spec(module) for module in ("numpy", "soundfile", "scipy")), "Optional waveform preparation dependencies are unavailable")
    def test_real_stereo_8k_audio_is_downmixed_resampled_and_kept_relative(self):
        import numpy as np
        import soundfile as sf
        source = self.root / "original.wav"
        signal = np.sin(np.arange(8000) * (2 * np.pi * 220 / 8000))
        sf.write(source, np.column_stack([signal * .2, signal * .4]), 8000, subtype="PCM_16")
        result = inspect_audio(source, self.root, "train", "fixture")
        converted, rate = sf.read(self.root / result["audio"])
        self.assertEqual(rate, 16000)
        self.assertEqual(converted.ndim, 1)
        self.assertEqual(len(converted), 16000)
        self.assertAlmostEqual(float(np.max(np.abs(converted))), .3, delta=.01)
        self.assertEqual(result["duration_seconds"], 1)
        self.assertEqual(result["audio_sha256"], hashlib.sha256((self.root / result["audio"]).read_bytes()).hexdigest())
        self.assertFalse(Path(result["audio"]).is_absolute())
        self.assertTrue(source.exists(), "Original source is preserved")


if __name__ == "__main__":
    unittest.main()
