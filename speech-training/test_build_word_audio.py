"""Portable standalone audio checks; no model loading or network calls."""
from array import array
import hashlib
import json
import math
from pathlib import Path
import tempfile
import unittest
import wave

from build_word_audio import collect_words, filename, normalize_word, verify_public, write_public


class StandaloneWordAudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.javascript = self.directory / 'lookup.js'
        self.words = {}
        self.add_word('leaf')

    def add_word(self, word, *, silent=False, channels=1):
        path = self.directory / filename(word)
        samples = array('h', [0 if silent else int(5000 * math.sin(2 * math.pi * 220 * index / 24000))
                              for index in range(14400)])
        with wave.open(str(path), 'wb') as audio:
            audio.setnchannels(channels); audio.setframerate(24000); audio.setsampwidth(2)
            audio.writeframes(samples.tobytes())
        self.words[word] = {'text': word, 'url': '../speech-training/word-audio/' + path.name,
            'duration_seconds': .6, 'audio_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'sample_rate': 24000, 'samples': 14400, 'channels': 1, 'bits_per_sample': 16,
            'standalone': True, 'reference': {'text': word, 'accent': 'en-us', 'ipa': 'liːf',
                'analysis_type': 'text_pronunciation_reference', 'audio_analyzed': False,
                'reference_context': 'isolated_word',
                'words': [{'index': 0, 'text': word, 'ipa': 'liːf', 'phones': ['l', 'iː', 'f']}]}}
        write_public(self.directory, self.javascript, self.words)

    def test_public_bundle_round_trip_has_same_json_lookup_and_complete_checksums(self):
        self.assertEqual(verify_public(self.directory)['words'], 1)
        manifest = json.loads((self.directory / 'manifest.json').read_text())
        assignment = self.javascript.read_text().split('globalThis.EGL_WORD_AUDIO = ', 1)[1].rsplit(';', 1)[0]
        self.assertEqual(json.loads(assignment), manifest)
        sums = (self.directory / 'SHA256SUMS').read_text()
        self.assertEqual(len(sums.splitlines()), 3)
        self.assertIn('  manifest.json\n', sums)
        self.assertIn('  ATTRIBUTION.txt\n', sums)
        self.assertIn('  ' + filename('leaf') + '\n', sums)
        before = self.javascript.read_bytes()
        write_public(self.directory, self.javascript, self.words)
        self.assertEqual(self.javascript.read_bytes(), before)

    def test_changed_audio_and_truncated_wav_are_rejected(self):
        path = self.directory / filename('leaf')
        path.write_bytes(path.read_bytes()[:-100])
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            verify_public(self.directory)
        self.words['leaf']['audio_sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
        write_public(self.directory, self.javascript, self.words)
        with self.assertRaisesRegex(ValueError, 'incomplete PCM frames'):
            verify_public(self.directory)

    def test_recording_must_be_standalone_with_one_isolated_text_reference(self):
        for change in ('standalone', 'reference'):
            with self.subTest(change=change):
                self.set_record(change, False if change == 'standalone' else {'audio_analyzed': True})
                with self.assertRaises(ValueError):
                    verify_public(self.directory)
                self.add_word('leaf')

    def set_record(self, name, value):
        self.words['leaf'][name] = value
        write_public(self.directory, self.javascript, self.words)

    def test_wrong_duration_silence_and_wrong_channel_layout_are_rejected(self):
        self.set_record('duration_seconds', 2)
        with self.assertRaisesRegex(ValueError, 'duration mismatch'):
            verify_public(self.directory)
        self.add_word('leaf', silent=True)
        with self.assertRaisesRegex(ValueError, 'Silent or inaudible'):
            verify_public(self.directory)
        self.add_word('leaf', channels=2)
        with self.assertRaisesRegex(ValueError, 'mono 24 kHz PCM16'):
            verify_public(self.directory)

    def test_public_metadata_symlinks_and_incomplete_checksum_inventory_are_rejected(self):
        sums = self.directory / 'SHA256SUMS'
        sums.write_text(sums.read_text().splitlines()[0] + '\n')
        with self.assertRaisesRegex(ValueError, 'coverage mismatch'):
            verify_public(self.directory)
        write_public(self.directory, self.javascript, self.words)
        target = self.directory / 'real-attribution'
        (self.directory / 'ATTRIBUTION.txt').rename(target)
        (self.directory / 'ATTRIBUTION.txt').symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'must not be symlinked'):
            verify_public(self.directory)

    def test_word_collection_covers_runtime_and_guides_without_guessing_invalid_keys(self):
        words = collect_words(Path(__file__).resolve().parents[1])
        self.assertGreaterEqual(len(words), 190)
        self.assertTrue({'leaf', 'root', 'green', 'make', 'a', 'to', "let's", 'thought', 'bottle'}.issubset(words))
        self.assertEqual(normalize_word('You’re'), "you're")
        self.assertEqual(normalize_word('AI'), 'ai')
        for invalid in ('two words', '../leaf', '<leaf>', '', None):
            self.assertIsNone(normalize_word(invalid))
        self.assertRegex(filename("you're"), r'^word-[a-f0-9]{16}\.wav$')


if __name__ == '__main__':
    unittest.main()
