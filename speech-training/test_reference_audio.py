import unittest

from build_reference_audio import playback_words


class ReferencePlaybackTests(unittest.TestCase):
    def test_context_stays_bounded_and_separate_across_missing_word(self):
        source = [
            {"index": 0, "text": "What", "start": 0.2, "end": 0.4},
            {"index": 1, "text": "do", "start": None, "end": None},
            {"index": 2, "text": "you", "start": 0.44, "end": 0.6},
        ]
        words = playback_words(source, 0.63)
        self.assertLessEqual(words[0]["end"], words[2]["start"])
        self.assertIsNone(words[1]["start"])
        self.assertIsNone(words[1]["end"])
        self.assertLessEqual(words[2]["end"], 0.63)
        self.assertEqual(words[2]["core_start"], 0.44)

    def test_no_negative_start_or_fabricated_invalid_range(self):
        words = playback_words([
            {"index": 0, "text": "Hi", "start": 0.01, "end": 0.2},
            {"index": 1, "text": "bad", "start": 2.0, "end": 3.0},
        ], 1.0)
        self.assertEqual(words[0]["start"], 0.0)
        self.assertIsNone(words[1]["start"])


if __name__ == '__main__':
    unittest.main()
