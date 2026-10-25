"""Meaningful model-free tests; the optional real G2P test uses no neural model."""
import importlib.util
from pathlib import Path
import shutil
import unittest
from unittest.mock import patch

import numpy as np

from phonetic_engine import (
    AnalysisError, PhoneticAnalyzer, align_phone_sequences, canonical_phone,
    decode_ctc_segments, waveform_metrics,
)


def word(text, phones, index=0):
    return {"index": index, "text": text, "ipa": "".join(phones), "phones": phones}


def observed(phones):
    return [{"phone": phone, "start": i * 0.1, "end": (i + 1) * 0.1}
            for i, phone in enumerate(phones)]


class PhoneticEngineTests(unittest.TestCase):
    def test_minimal_pair_identifies_vowel_not_character_edits(self):
        result = align_phone_sequences([word("ship", ["ʃ", "ɪ", "p"])], observed(["ʃ", "iː", "p"]))
        self.assertEqual([op["type"] for op in result["operations"]], ["match", "substitute", "match"])
        self.assertEqual(result["words"][0]["differences"], [{
            "type": "substitute", "expected": "ɪ", "observed": "iː", "start": 0.1, "end": 0.2,
        }])

    def test_affricate_and_long_rhotic_are_intact_units(self):
        result = align_phone_sequences([word("chair", ["tʃ", "ɑːɹ"])], observed(["t͡ʃ", "ɑːɹ"]))
        self.assertEqual(len(result["operations"]), 2)
        self.assertEqual(result["words"][0]["status"], "matched")
        self.assertEqual(canonical_phone("ˈg"), "ɡ")
        self.assertNotEqual(canonical_phone("r"), canonical_phone("ɹ"))
        self.assertNotEqual(canonical_phone("i"), canonical_phone("iː"))

    def test_deleted_word_has_no_invented_audio_times(self):
        result = align_phone_sequences(
            [word("we", ["w", "iː"]), word("go", ["ɡ", "oʊ"], 1)], observed(["w", "iː"]),
        )
        missing = result["words"][1]
        self.assertEqual(missing["status"], "difference")
        self.assertIsNone(missing["start"])
        self.assertIsNone(missing["end"])
        self.assertEqual([d["type"] for d in missing["differences"]], ["delete", "delete"])

    def test_inserted_sound_has_observed_time_and_word_provenance(self):
        result = align_phone_sequences([word("cat", ["k", "æ", "t"])], observed(["k", "æ", "t", "ə"]))
        operation = result["operations"][-1]
        self.assertEqual(operation["type"], "insert")
        self.assertEqual(operation["word_index"], 0)
        self.assertEqual(operation["observed"], "ə")
        self.assertGreater(operation["end"], operation["start"])

    def test_percent_counts_phone_units_and_penalizes_insertions(self):
        minimal = align_phone_sequences([word("ship", ["ʃ", "ɪ", "p"])], observed(["ʃ", "iː", "p"]))
        self.assertEqual(minimal["words"][0]["match_percent"], 66.7)
        self.assertEqual(minimal["summary"]["matched_phones"], 2)
        self.assertEqual(minimal["summary"]["compared_phones"], 3)
        extra = align_phone_sequences([word("cat", ["k", "æ", "t"])], observed(["k", "æ", "t", "ə"]))
        self.assertEqual(extra["words"][0]["match_percent"], 75.0)
        self.assertEqual(extra["summary"]["inserted_phones"], 1)
        self.assertFalse(extra["summary"]["calibrated_pronunciation_grade"])

    def test_overall_percent_weights_phone_counts_and_missing_word_is_zero(self):
        result = align_phone_sequences(
            [word("we", ["w", "iː"]), word("go", ["ɡ", "oʊ"], 1)], observed(["w", "iː"]))
        self.assertEqual(result["words"][0]["match_percent"], 100.0)
        self.assertEqual(result["words"][1]["match_percent"], 0.0)
        self.assertEqual(result["summary"]["match_percent"], 50.0)
        uneven = align_phone_sequences(
            [word("I", ["aɪ"]), word("cat", ["k", "æ", "t"], 1)], observed(["aɪ", "k", "ɛ", "t"]))
        self.assertEqual(uneven["summary"]["match_percent"], 75.0)
        self.assertNotEqual(uneven["summary"]["match_percent"],
            sum(w["match_percent"] for w in uneven["words"]) / 2)

    def test_absent_audio_is_unassessed_and_multichar_phone_counts_once(self):
        absent = align_phone_sequences([word("chair", ["tʃ", "ɑːɹ"])], [])
        self.assertIsNone(absent["summary"]["match_percent"])
        self.assertIsNone(absent["words"][0]["match_percent"])
        match = align_phone_sequences([word("chair", ["tʃ", "ɑːɹ"])], observed(["t͡ʃ", "ɑːɹ"]))
        self.assertEqual(match["summary"]["reference_phones"], 2)
        self.assertEqual(match["summary"]["match_percent"], 100.0)

    def test_word_practice_uses_original_sentence_weak_form(self):
        analyzer = PhoneticAnalyzer()
        context = {"words": [word("a", ["ɐ"], 0)]}
        with patch.object(analyzer, "annotate_text", return_value=context), \
                patch.object(analyzer, "_recognize", return_value=observed(["ɐ"])):
            result = analyzer.analyze_waveform(np.full(16000, 0.05), "a",
                context_text="a leaf", context_word_index=0)
        self.assertEqual(result["reference"]["words"][0]["phones"], ["ɐ"])
        self.assertEqual(result["alignment"]["summary"]["match_percent"], 100.0)
        self.assertEqual(result["reference"]["reference_context"], "word_in_sentence")

    def test_word_context_must_match_target_and_be_complete(self):
        analyzer = PhoneticAnalyzer()
        with patch.object(analyzer, "annotate_text", return_value={"words": [word("leaf", ["l", "iː", "f"])]}), \
                patch.object(analyzer, "_recognize", side_effect=AssertionError("must not run")):
            for kwargs in [{"context_text": "leaf"}, {"context_word_index": 0},
                           {"context_text": "leaf", "context_word_index": 2},
                           {"context_text": "leaf", "context_word_index": 0}]:
                with self.subTest(kwargs=kwargs), self.assertRaises(AnalysisError):
                    analyzer.analyze_waveform(np.full(16000, 0.05), "root", **kwargs)

    def test_phone_practice_selects_one_context_phone_without_forcing_observed_audio(self):
        analyzer = PhoneticAnalyzer()
        context = {"words": [word("a", ["ɐ"]), word("leaf", ["l", "iː", "f"], 1)]}
        acoustic = observed(["f"])
        with patch.object(analyzer, "annotate_text", return_value=context), \
                patch.object(analyzer, "_recognize", return_value=acoustic) as recognize:
            first = analyzer.analyze_waveform(np.full(16000, 0.05), "leaf",
                context_text="a leaf", context_word_index=1, context_phone_index=0)
            final = analyzer.analyze_waveform(np.full(16000, 0.05), "leaf",
                context_text="a leaf", context_word_index=1, context_phone_index=2)
        self.assertEqual(recognize.call_count, 2)
        self.assertEqual(first["observed"], final["observed"])
        self.assertEqual(first["observed"]["phones"], acoustic)
        reference = first["reference"]
        self.assertEqual(reference["text"], "leaf")
        self.assertEqual(reference["ipa"], "l")
        self.assertEqual(reference["words"], [{"index": 0, "text": "leaf", "ipa": "l", "phones": ["l"]}])
        self.assertEqual(reference["reference_context"], "phone_in_word")
        self.assertEqual(reference["context"], {"text": "a leaf", "word_index": 1, "phone_index": 0})
        self.assertIn("ทั้งคำ", reference["notes"][0])
        self.assertEqual(first["alignment"]["summary"]["match_percent"], 0.0)
        self.assertEqual(final["reference"]["words"][0]["phones"], ["f"])
        self.assertEqual(final["alignment"]["summary"]["match_percent"], 100.0)

    def test_phone_practice_keeps_affricate_units_and_counts_repeated_observations(self):
        analyzer = PhoneticAnalyzer()
        context = {"words": [word("chair", ["tʃ", "ɛɹ"])]}
        with patch.object(analyzer, "annotate_text", return_value=context), \
                patch.object(analyzer, "_recognize", side_effect=[observed(["t͡ʃ"]), observed(["t͡ʃ", "tʃ"]) ]):
            single = analyzer.analyze_waveform(np.full(16000, 0.05), "chair",
                context_text="chair", context_word_index=0, context_phone_index=0)
            repeated = analyzer.analyze_waveform(np.full(16000, 0.05), "chair",
                context_text="chair", context_word_index=0, context_phone_index=0)
        self.assertEqual(single["reference"]["words"][0]["phones"], ["tʃ"])
        self.assertEqual(single["alignment"]["summary"]["reference_phones"], 1)
        self.assertEqual(single["alignment"]["summary"]["match_percent"], 100.0)
        self.assertEqual(repeated["alignment"]["summary"]["inserted_phones"], 1)
        self.assertEqual(repeated["alignment"]["summary"]["match_percent"], 50.0)

    def test_phone_context_requires_matching_word_and_valid_phone_index_before_inference(self):
        analyzer = PhoneticAnalyzer()
        with patch.object(analyzer, "annotate_text", return_value={"words": [word("leaf", ["l", "iː", "f"])]}), \
                patch.object(analyzer, "_recognize", side_effect=AssertionError("must not run")):
            invalid = [
                {"context_phone_index": 0},
                {"context_text": "leaf", "context_phone_index": 0},
                {"context_word_index": 0, "context_phone_index": 0},
                {"context_text": "leaf", "context_word_index": -1, "context_phone_index": 0},
                {"context_text": "leaf", "context_word_index": 0, "context_phone_index": -1},
                {"context_text": "leaf", "context_word_index": 0, "context_phone_index": 3},
                {"context_text": "leaf", "context_word_index": 0, "context_phone_index": 1.5},
                {"context_text": "leaf", "context_word_index": 0, "context_phone_index": False},
            ]
            for kwargs in invalid:
                with self.subTest(kwargs=kwargs), self.assertRaises(AnalysisError):
                    analyzer.analyze_waveform(np.full(16000, 0.05), "leaf", **kwargs)
            with self.assertRaises(AnalysisError):
                analyzer.analyze_waveform(np.full(16000, 0.05), "f",
                    context_text="leaf", context_word_index=0, context_phone_index=2)

    def test_phone_practice_retains_audio_duration_and_silence_thresholds(self):
        analyzer = PhoneticAnalyzer()
        with patch.object(analyzer, "annotate_text", side_effect=AssertionError("must not run")), \
                patch.object(analyzer, "_recognize", side_effect=AssertionError("must not run")):
            for audio in [np.full(3200, 0.05), np.full(16 * 16000, 0.05), np.zeros(16000)]:
                with self.subTest(samples=len(audio)), self.assertRaises(AnalysisError):
                    analyzer.analyze_waveform(audio, "leaf", context_text="leaf",
                        context_word_index=0, context_phone_index=0)

    def test_ctc_blank_preserves_separate_identical_phones(self):
        phones = decode_ctc_segments(
            [0, 4, 4, 0, 4, 5, 5, 1], {0: "<pad>", 1: "<s>", 4: "t", 5: "tʃ"},
            blank_id=0, duration_seconds=0.15, frame_seconds=0.02,
        )
        self.assertEqual([p["phone"] for p in phones], ["t", "t", "tʃ"])
        self.assertEqual(phones[0], {"phone": "t", "start": 0.02, "end": 0.06})
        for previous, current in zip(phones, phones[1:]):
            self.assertLessEqual(previous["end"], current["start"])
        self.assertTrue(all(0 <= p["start"] < p["end"] <= 0.15 for p in phones))

    def test_silence_and_invalid_audio_rejected_before_model_loading(self):
        analyzer = PhoneticAnalyzer()
        bad_inputs = [np.zeros(16000), np.full(16000, 1e-6), np.zeros(100),
                      np.zeros(16 * 16000), np.full(16000, np.nan), np.ones((16000, 2))]
        with patch.object(analyzer, "_recognize", side_effect=AssertionError("must not run")):
            for waveform in bad_inputs:
                with self.subTest(shape=waveform.shape), self.assertRaises(AnalysisError):
                    analyzer.analyze_waveform(waveform, "Hello.")
        self.assertIsNone(analyzer._model)

    def test_energy_metrics_are_finite_and_duration_bounded(self):
        audio = (0.1 * np.sin(2 * np.pi * 220 * np.arange(16000) / 16000)).astype(np.float32)
        _, metrics = waveform_metrics(audio)
        self.assertEqual(metrics["duration_seconds"], 1.0)
        self.assertAlmostEqual(metrics["rms_dbfs"], -23.01, places=2)
        self.assertGreater(metrics["voiced_seconds"], 0.9)
        self.assertLessEqual(metrics["voiced_seconds"], 1.0)

    def test_text_reference_preserves_contractions_and_never_claims_audio(self):
        analyzer = PhoneticAnalyzer()
        with patch.object(analyzer, "_phonemize_words", return_value=(
            [["d", "oʊ", "n", "t"], ["s", "t", "ɑː", "p"]], ["dˈoʊnt", "stˈɑːp"], "sentence",
        )) as g2p:
            result = analyzer.annotate_text("Don't stop!", "en-us")
        g2p.assert_called_once_with(["Don't", "stop"], "en-us", sentence="Don't stop!")
        self.assertFalse(result["audio_analyzed"])
        self.assertEqual(result["analysis_type"], "text_pronunciation_reference")
        self.assertEqual(result["words"][0]["text"], "Don't")

    def test_empty_text_and_unknown_accent_rejected(self):
        analyzer = PhoneticAnalyzer()
        for text, accent in [("", "en-us"), ("สวัสดี", "en-us"), ("hello", "xx"), ("a" * 1001, "en-us")]:
            with self.subTest(text=text[:10]), self.assertRaises(AnalysisError):
                analyzer.annotate_text(text, accent)

    def test_acoustic_response_comes_from_recognizer_not_expected_ipa(self):
        analyzer = PhoneticAnalyzer()
        audio = np.full(16000, 0.05, np.float32)
        with patch.object(analyzer, "_phonemize_words", return_value=(
            [["ʃ", "ɪ", "p"]], ["ʃˈɪp"], "sentence",
        )), patch.object(analyzer, "_recognize", return_value=observed(["ʃ", "iː", "p"])):
            result = analyzer.analyze_waveform(audio, "ship")
        self.assertTrue(result["audio_analyzed"])
        self.assertNotEqual(result["observed"]["ipa"], result["reference"]["ipa"])
        self.assertEqual(result["alignment"]["words"][0]["status"], "difference")
        self.assertNotIn("score", result)
        self.assertNotIn("confidence", result)

    def test_model_empty_decode_is_not_replaced_by_text_ipa(self):
        analyzer = PhoneticAnalyzer()
        with patch.object(analyzer, "_phonemize_words", return_value=([["h"]], ["h"], "sentence")), \
                patch.object(analyzer, "_recognize", return_value=[]), self.assertRaises(AnalysisError):
            analyzer.analyze_waveform(np.full(16000, 0.05), "hello")

    @unittest.skipUnless(importlib.util.find_spec("phonemizer") is not None and (
        shutil.which("espeak-ng") or Path("/opt/homebrew/opt/espeak-ng/lib/libespeak-ng.dylib").exists()
    ), "phonemizer/eSpeak NG not installed")
    def test_real_g2p_both_accents_and_contraction(self):
        analyzer = PhoneticAnalyzer()
        for accent in ("en-us", "en-gb"):
            result = analyzer.annotate_text("Don't choose thin shoes.", accent)
            self.assertEqual([w["text"] for w in result["words"]], ["Don't", "choose", "thin", "shoes"])
            self.assertTrue(all(w["ipa"] and w["phones"] for w in result["words"]))
            self.assertTrue(any("θ" in w["phones"] for w in result["words"]))
            self.assertTrue(all("ˈ" not in p and "ˌ" not in p for w in result["words"] for p in w["phones"]))
        self.assertIsNone(analyzer._model)

    @unittest.skipUnless(importlib.util.find_spec("phonemizer") is not None and (
        shutil.which("espeak-ng") or Path("/opt/homebrew/opt/espeak-ng/lib/libespeak-ng.dylib").exists()
    ), "phonemizer/eSpeak NG not installed")
    def test_sentence_context_keeps_article_weak_form(self):
        result = PhoneticAnalyzer().annotate_text("This is a leaf", "en-us")
        self.assertEqual(result["reference_context"], "sentence")
        article = result["words"][2]
        self.assertEqual(article["text"], "a")
        self.assertTrue(set(article["phones"]) & {"ɐ", "ə"})
        self.assertNotIn("eɪ", article["phones"])

    @unittest.skipUnless(importlib.util.find_spec("phonemizer") is not None and (
        shutil.which("espeak-ng") or Path("/opt/homebrew/opt/espeak-ng/lib/libespeak-ng.dylib").exists()
    ), "phonemizer/eSpeak NG not installed")
    def test_sentence_word_count_mismatch_falls_back_explicitly(self):
        # Force sentence output to have one chunk for two source words, then
        # verify the fallback uses complete word outputs rather than misassigning.
        with patch("phonemizer.phonemize", side_effect=[
            ["h ə l oʊ"], ["h ə l ˈoʊ"],
            ["h ə l oʊ", "w ɜː l d"], ["h ə l ˈoʊ", "w ˈɜː l d"],
        ]):
            result = PhoneticAnalyzer().annotate_text("Hello world", "en-us")
        self.assertEqual(result["reference_context"], "isolated_words")
        self.assertEqual(result["words"][1]["phones"], ["w", "ɜː", "l", "d"])
        self.assertTrue(result["notes"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
