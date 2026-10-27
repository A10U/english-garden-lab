from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from train_english_phoneme import (
    collapse_ctc, configure_trainable, edit_distance, epoch_order, load_splits,
    lr_multiplier, safe_audio_path, select_evaluation, validate_output,
)


class Parameter:
    def __init__(self, size):
        self.size, self.requires_grad = size, None
    def numel(self):
        return self.size
    def requires_grad_(self, value):
        self.requires_grad = value


class TrainEnglishPhonemeTests(unittest.TestCase):
    def setUp(self):
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


if __name__ == "__main__":
    unittest.main()
