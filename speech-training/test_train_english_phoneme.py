from __future__ import annotations

import contextlib
import io
import json
from pathlib import Path
import random
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from train_english_phoneme import (
    capture_rng_state, collapse_ctc, configure_trainable, edit_distance, epoch_order, load_splits,
    lr_multiplier, main, restore_rng_state, safe_audio_path, seed_rng, select_evaluation,
    validate_device, validate_output,
)


class Parameter:
    def __init__(self, size):
        self.size, self.requires_grad = size, None
    def numel(self):
        return self.size
    def requires_grad_(self, value):
        self.requires_grad = value


def fake_rng_backends(*, cuda_available=True, cuda_devices=2, mps_available=True):
    cuda = SimpleNamespace(is_available=Mock(return_value=cuda_available),
        device_count=Mock(return_value=cuda_devices), manual_seed_all=Mock(),
        get_rng_state_all=Mock(return_value=[f"cuda-{index}-state" for index in range(cuda_devices)]),
        set_rng_state_all=Mock())
    mps = SimpleNamespace(manual_seed=Mock(), get_rng_state=Mock(return_value="mps-state"), set_rng_state=Mock())
    torch = SimpleNamespace(cuda=cuda, mps=mps, manual_seed=Mock(),
        get_rng_state=Mock(return_value="cpu-state"), set_rng_state=Mock(),
        backends=SimpleNamespace(mps=SimpleNamespace(is_available=Mock(return_value=mps_available))))
    numpy = SimpleNamespace(random=SimpleNamespace(seed=Mock(), get_state=Mock(return_value="numpy-state"), set_state=Mock()))
    return torch, numpy


class TrainEnglishPhonemeTests(unittest.TestCase):
    def setUp(self):
        original_random = random.getstate()
        self.addCleanup(random.setstate, original_random)
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.vocab = {"<pad>": 0, "t": 1, "ɛ": 2, "s": 3}
        self.records = {}
        for split in ("train", "validation", "test"):
            audio = self.root / f"{split}.flac"
            audio.write_bytes(b"fixture")
            row = {"id": split + "-1", "audio": audio.name, "text": "test", "speaker_id": split,
                   "chapter_id": "1", "split": split, "sample_rate_hz": 16000, "duration_seconds": 1.0,
                   "phones": ["t", "ɛ", "s", "t"], "phone_ids": [1, 2, 3, 1],
                   "label_source": "canonical_espeak", "label_kind": "canonical_text_reference", "human_reviewed": False}
            self.records[split] = [row]
        self.save()

    def tearDown(self):
        self.temporary.cleanup()

    def save(self):
        for split, rows in self.records.items():
            (self.root / f"{split}.jsonl").write_text("".join(json.dumps(row) + "\n" for row in rows))

    def test_ctc_duplicates_only_survive_blank_separator(self):
        self.assertEqual(collapse_ctc([0, 1, 1, 0, 1, 2, 2, 0], 0), [1, 1, 2])
        self.assertEqual(edit_distance([1, 2, 3], [1, 4, 3, 2]), 2)

    def test_resume_order_and_cursor_reproduce_uninterrupted_sampling(self):
        full = epoch_order(29, 3407, 2)
        self.assertEqual(full[:16] + epoch_order(29, 3407, 2)[16:], full)
        self.assertNotEqual(full, epoch_order(29, 3407, 3))
        self.assertEqual(sorted(full), list(range(29)))
        self.assertEqual(select_evaluation(list(range(29)), 8, 3407), select_evaluation(list(range(29)), 8, 3407))
        self.assertEqual(len(select_evaluation(list(range(29)), 0, 3407)), 29)

    def test_warmup_then_decay_finishes_at_zero(self):
        values = [lr_multiplier(step, 2, 8) for step in range(9)]
        self.assertEqual(values[:3], [.5, 1, 1])
        self.assertEqual(values[-1], 0)
        self.assertTrue(all(a >= b for a, b in zip(values[2:], values[3:])))

    def test_valid_split_fingerprints_and_truthful_duration_exclusions(self):
        extra = {**self.records["train"][0], "id": "long", "audio": "long.flac", "duration_seconds": 36}
        (self.root / "long.flac").write_bytes(b"fixture")
        self.records["train"].append(extra); self.save()
        splits, stats, hashes = load_splits(self.root, self.vocab, 35)
        self.assertEqual(len(splits["train"]), 1)
        self.assertEqual(stats["train"]["excluded_long_utterances"], 1)
        self.assertAlmostEqual(stats["train"]["manifest_hours"], 37 / 3600)
        self.assertAlmostEqual(stats["train"]["included_hours"], 1 / 3600)
        self.assertEqual(len(hashes["validation"]), 64)

    def test_speakers_may_repeat_within_train_but_never_across_splits(self):
        self.records["validation"][0]["speaker_id"] = "train"; self.save()
        with self.assertRaisesRegex(ValueError, "overlap or duplicate speaker"):
            load_splits(self.root, self.vocab, 35)

    def test_duplicate_audio_even_within_split_is_rejected(self):
        self.records["train"].append({**self.records["train"][0], "id": "another"}); self.save()
        with self.assertRaisesRegex(ValueError, "duplicate audio"):
            load_splits(self.root, self.vocab, 35)

    def test_vocab_and_human_annotation_claims_are_checked(self):
        self.records["train"][0]["phone_ids"][0] = 0; self.save()
        with self.assertRaisesRegex(ValueError, "vocabulary"):
            load_splits(self.root, self.vocab, 35)
        self.records["train"][0]["phone_ids"][0] = 1
        self.records["train"][0]["human_reviewed"] = True; self.save()
        with self.assertRaisesRegex(ValueError, "unreviewed"):
            load_splits(self.root, self.vocab, 35)

    def test_ctc_impossible_repeated_labels_are_rejected(self):
        self.records["train"][0].update(duration_seconds=.3, phones=["t"] * 10, phone_ids=[1] * 10); self.save()
        with self.assertRaisesRegex(ValueError, "CTC frames"):
            load_splits(self.root, self.vocab, 35)

    def test_paths_and_output_cannot_escape_or_overwrite_sources(self):
        with self.assertRaisesRegex(ValueError, "relative"):
            safe_audio_path(self.root, str(self.root / "train.flac"))
        with self.assertRaisesRegex(ValueError, "escaped"):
            safe_audio_path(self.root, "../elsewhere.wav")
        with self.assertRaisesRegex(ValueError, "separate"):
            validate_output(self.root / "model", self.root / "data", self.root)
        with self.assertRaisesRegex(ValueError, "separate"):
            validate_output(self.root / "model", self.root / "data", self.root / "model/candidate")

    def test_only_requested_final_layers_and_ctc_head_are_trainable(self):
        class Model:
            wav2vec2 = type("Backbone", (), {"encoder": type("Encoder", (), {"layers": [0] * 4})()})()
            parameters = {name: Parameter(10) for name in ["wav2vec2.feature_extractor.weight", "wav2vec2.encoder.layers.0.weight",
                "wav2vec2.encoder.layers.1.weight", "wav2vec2.encoder.layers.2.weight", "wav2vec2.encoder.layers.3.weight", "lm_head.weight"]}
            def named_parameters(self):
                return self.parameters.items()
        model = Model()
        result = configure_trainable(model, 2)
        self.assertEqual(result["trainable_parameters"], 30)
        self.assertEqual([name for name, p in model.parameters.items() if p.requires_grad], ["wav2vec2.encoder.layers.2.weight", "wav2vec2.encoder.layers.3.weight", "lm_head.weight"])
        with self.assertRaisesRegex(ValueError, "between"):
            configure_trainable(model, 5)

    def test_requested_accelerator_must_exist_without_implicit_cpu_fallback(self):
        torch, _ = fake_rng_backends(cuda_available=False, mps_available=False)
        validate_device("cpu", torch)
        with self.assertRaisesRegex(RuntimeError, "CUDA is unavailable.*cpu explicitly"):
            validate_device("cuda", torch)
        with self.assertRaisesRegex(RuntimeError, "MPS is unavailable.*cpu explicitly"):
            validate_device("mps", torch)
        with self.assertRaisesRegex(ValueError, "explicit"):
            validate_device("automatic", torch)
        torch.manual_seed.assert_not_called()
        torch.cuda.manual_seed_all.assert_not_called()

    def test_cuda_seed_and_checkpoint_cover_every_visible_generator(self):
        torch, numpy = fake_rng_backends(cuda_devices=2)
        validate_device("cuda", torch)
        seed_rng(3407, "cuda", torch, numpy)
        numpy.random.seed.assert_called_once_with(3407)
        torch.manual_seed.assert_called_once_with(3407)
        torch.cuda.manual_seed_all.assert_called_once_with(3407)
        torch.mps.manual_seed.assert_not_called()
        saved = capture_rng_state("cuda", torch, numpy)
        self.assertEqual(set(saved), {"python", "numpy", "torch", "cuda"})
        self.assertEqual(saved["cuda"], ["cuda-0-state", "cuda-1-state"])
        restore_rng_state(saved, "cuda", torch, numpy)
        numpy.random.set_state.assert_called_once_with("numpy-state")
        torch.set_rng_state.assert_called_once_with("cpu-state")
        torch.cuda.set_rng_state_all.assert_called_once_with(["cuda-0-state", "cuda-1-state"])
        torch.mps.set_rng_state.assert_not_called()

    def test_cuda_resume_rejects_missing_or_partial_device_states_before_changing_any_rng(self):
        for values in (None, [], ["only-one"], ["one", "two", "three"]):
            with self.subTest(values=values):
                torch, numpy = fake_rng_backends(cuda_devices=2)
                saved = {"python": random.getstate(), "numpy": "numpy-state", "torch": "cpu-state"}
                if values is not None:
                    saved["cuda"] = values
                before = random.getstate()
                with self.assertRaisesRegex(ValueError, "all visible CUDA devices"):
                    restore_rng_state(saved, "cuda", torch, numpy)
                self.assertEqual(random.getstate(), before)
                numpy.random.set_state.assert_not_called()
                torch.set_rng_state.assert_not_called()
                torch.cuda.set_rng_state_all.assert_not_called()

    def test_existing_cpu_and_mps_rng_checkpoint_shapes_remain_compatible(self):
        for device in ("cpu", "mps"):
            with self.subTest(device=device):
                torch, numpy = fake_rng_backends()
                seed_rng(3407, device, torch, numpy)
                saved = capture_rng_state(device, torch, numpy)
                self.assertEqual(set(saved), {"python", "numpy", "torch"} | ({"mps"} if device == "mps" else set()))
                restore_rng_state(saved, device, torch, numpy)
                torch.set_rng_state.assert_called_once_with("cpu-state")
                if device == "mps":
                    torch.mps.manual_seed.assert_called_once_with(3407)
                    torch.mps.set_rng_state.assert_called_once_with("mps-state")
                else:
                    torch.mps.manual_seed.assert_not_called()
                    torch.mps.set_rng_state.assert_not_called()
                torch.cuda.manual_seed_all.assert_not_called()
                torch.cuda.get_rng_state_all.assert_not_called()
                torch.cuda.set_rng_state_all.assert_not_called()

    def test_missing_required_rng_state_is_rejected(self):
        torch, numpy = fake_rng_backends()
        with self.assertRaisesRegex(ValueError, "incomplete"):
            restore_rng_state({}, "cpu", torch, numpy)
        with self.assertRaisesRegex(ValueError, "missing.*MPS"):
            restore_rng_state({"python": random.getstate(), "numpy": "numpy-state", "torch": "cpu-state"}, "mps", torch, numpy)
        torch.set_rng_state.assert_not_called()

    def test_real_cpu_rng_roundtrip_through_a_cpu_loaded_checkpoint_replays_next_samples(self):
        try:
            import numpy
            import torch
        except ImportError:
            self.skipTest("Existing NumPy/PyTorch dependencies are unavailable")
        original = capture_rng_state("cpu", torch, numpy)
        try:
            seed_rng(3407, "cpu", torch, numpy)
            saved = capture_rng_state("cpu", torch, numpy)
            buffer = io.BytesIO()
            torch.save({"rng": saved}, buffer)
            expected = (random.random(), numpy.random.random(3).tolist(), torch.rand(3).tolist())
            random.random(); numpy.random.random(7); torch.rand(7)
            buffer.seek(0)
            loaded = torch.load(buffer, map_location="cpu", weights_only=False)
            self.assertEqual(loaded["rng"]["torch"].device.type, "cpu")
            restore_rng_state(loaded["rng"], "cpu", torch, numpy)
            actual = (random.random(), numpy.random.random(3).tolist(), torch.rand(3).tolist())
            self.assertEqual(actual, expected)
        finally:
            restore_rng_state(original, "cpu", torch, numpy)

    def test_real_cuda_absence_fails_before_loading_a_model_or_dataset(self):
        try:
            import torch
            import numpy
            import soundfile
        except ImportError:
            self.skipTest("Existing training dependencies are unavailable")
        if torch.cuda.is_available():
            self.skipTest("This negative preflight check requires a host without CUDA")
        output = self.root / "cuda-unavailable"
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            code = main(["--device", "cuda", "--model", str(self.root / "unavailable-model"),
                         "--data", str(self.root / "unavailable-data"), "--output", str(output), "--max-steps", "1"])
        self.assertEqual(code, 1)
        status = json.loads((output / "status.json").read_text())
        self.assertEqual(status["status"], "failed")
        self.assertIn("CUDA is unavailable", status["error"])
        self.assertFalse((output / "checkpoint.pt").exists())
        self.assertFalse((output / "run-config.json").exists())

    def test_real_cuda_rng_roundtrip_when_hardware_is_available(self):
        try:
            import numpy
            import torch
        except ImportError:
            self.skipTest("Existing NumPy/PyTorch dependencies are unavailable")
        if not torch.cuda.is_available():
            self.skipTest("CUDA hardware unavailable; no actual GPU RNG replay was executed")
        validate_device("cuda", torch)
        original = capture_rng_state("cuda", torch, numpy)
        try:
            seed_rng(3407, "cuda", torch, numpy)
            saved = capture_rng_state("cuda", torch, numpy)
            self.assertEqual(len(saved["cuda"]), torch.cuda.device_count())
            self.assertTrue(all(value.device.type == "cpu" and value.dtype == torch.uint8 for value in saved["cuda"]))
            checkpoint = io.BytesIO()
            torch.save({"rng": saved}, checkpoint)
            expected = [torch.rand(3, device=f"cuda:{index}").cpu().tolist() for index in range(torch.cuda.device_count())]
            for index in range(torch.cuda.device_count()):
                torch.rand(7, device=f"cuda:{index}")
            checkpoint.seek(0)
            loaded = torch.load(checkpoint, map_location="cpu", weights_only=False)
            restore_rng_state(loaded["rng"], "cuda", torch, numpy)
            actual = [torch.rand(3, device=f"cuda:{index}").cpu().tolist() for index in range(torch.cuda.device_count())]
            self.assertEqual(actual, expected)
        finally:
            restore_rng_state(original, "cuda", torch, numpy)


if __name__ == "__main__":
    unittest.main()
