"""API boundary checks without loading or downloading the acoustic model."""
import io
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import wave

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from phonetic_server import app, analyzer, MAX_BYTES
import phonetic_server as server


class PhoneticAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_microphone_worklet_is_available_to_local_practice_pages(self):
        response = self.client.get('/app/microphone-processor.js')
        self.assertEqual(response.status_code, 200)
        self.assertIn('javascript', response.headers['content-type'])
        self.assertIn("registerProcessor('egl-microphone'", response.text)
        for name in ('speak.html', 'speak.js', 'speak.css'):
            self.assertEqual(self.client.get('/app/' + name).status_code, 200, name)

    def test_text_reference_is_explicitly_not_audio_analysis(self):
        response = self.client.post('/api/phonetics/text', json={'text': 'This is a leaf.', 'accent': 'en-us'})
        self.assertEqual(response.status_code, 200, response.text)
        value = response.json()
        self.assertFalse(value['audio_analyzed'])
        self.assertEqual([word['text'] for word in value['words']], ['This', 'is', 'a', 'leaf'])
        self.assertIn('f', value['words'][-1]['phones'])

    def test_wrong_accent_and_empty_text_rejected(self):
        for body in [{'text': 'leaf', 'accent': 'th'}, {'text': '   ', 'accent': 'en-us'}]:
            self.assertEqual(self.client.post('/api/phonetics/text', json=body).status_code, 422)

    def test_silence_rejected_without_loading_model(self):
        output = io.BytesIO()
        sf.write(output, np.zeros(16000, dtype=np.float32), 16000, format='WAV')
        response = self.client.post('/api/phonetics/analyze', data={'text': 'leaf', 'accent': 'en-us'},
            files={'audio': ('quiet.wav', output.getvalue(), 'audio/wav')})
        self.assertEqual(response.status_code, 422, response.text)
        self.assertIn('เสียง', response.json()['detail'])

    def test_corrupt_audio_and_overlong_clip_rejected(self):
        bad = self.client.post('/api/phonetics/analyze', data={'text': 'leaf'},
            files={'audio': ('bad.wav', b'not an audio file', 'audio/wav')})
        self.assertEqual(bad.status_code, 422)
        output = io.BytesIO()
        sf.write(output, np.ones(16 * 16000, dtype=np.float32) * 0.1, 16000, format='WAV')
        long = self.client.post('/api/phonetics/analyze', data={'text': 'leaf'},
            files={'audio': ('long.wav', output.getvalue(), 'audio/wav')})
        self.assertEqual(long.status_code, 422)
        self.assertIn('15', long.json()['detail'])

    def test_private_files_and_foreign_origins_are_not_exposed(self):
        for path in ['/speech-training/model-source.json', '/speech-training/models/phoneme-ctc/pytorch_model.bin', '/app/tests/core.test.cjs']:
            self.assertEqual(self.client.get(path).status_code, 404)
        response = self.client.post('/api/phonetics/text', headers={'Origin': 'https://example.com'}, json={'text': 'leaf'})
        self.assertEqual(response.status_code, 403)
        response = self.client.options('/api/phonetics/analyze', headers={
            'Origin': 'null', 'Access-Control-Request-Method': 'POST'})
        self.assertEqual(response.headers.get('access-control-allow-origin'), 'null')

    def test_phone_context_api_changes_only_the_reference_and_keeps_word_mode_compatible(self):
        context = {"words": [
            {"index": 0, "text": "a", "ipa": "ɐ", "phones": ["ɐ"]},
            {"index": 1, "text": "leaf", "ipa": "liːf", "phones": ["l", "iː", "f"]},
        ]}
        acoustic = [{"phone": "f", "start": 0.1, "end": 0.3}]
        recording = self.recording_bytes(np.full(16000, 0.05))
        base = {"text": "leaf", "context_text": "a leaf", "context_word_index": 1}
        with patch.object(analyzer, 'annotate_text', return_value=context), \
                patch.object(analyzer, '_recognize', return_value=acoustic) as recognize:
            first = self.client.post('/api/phonetics/analyze', data={**base, 'context_phone_index': 0},
                files={'audio': ('practice.wav', recording, 'audio/wav')})
            final = self.client.post('/api/phonetics/analyze', data={**base, 'context_phone_index': 2},
                files={'audio': ('practice.wav', recording, 'audio/wav')})
            whole_word = self.client.post('/api/phonetics/analyze', data=base,
                files={'audio': ('practice.wav', recording, 'audio/wav')})
        for response in [first, final, whole_word]:
            self.assertEqual(response.status_code, 200, response.text[:200])
        self.assertEqual(recognize.call_count, 3)
        self.assertEqual(first.json()['observed'], final.json()['observed'])
        self.assertEqual(first.json()['reference']['context'], {'text': 'a leaf', 'word_index': 1, 'phone_index': 0})
        self.assertEqual(first.json()['reference']['reference_context'], 'phone_in_word')
        self.assertEqual(first.json()['reference']['words'][0]['phones'], ['l'])
        self.assertEqual(first.json()['alignment']['summary']['match_percent'], 0.0)
        self.assertEqual(final.json()['alignment']['summary']['match_percent'], 100.0)
        self.assertEqual(whole_word.json()['reference']['reference_context'], 'word_in_sentence')
        self.assertEqual(whole_word.json()['reference']['words'][0]['phones'], ['l', 'iː', 'f'])
        self.assertNotIn('phone_index', whole_word.json()['reference']['context'])

    def test_phone_without_word_context_is_rejected_before_decoding(self):
        with patch.object(server, 'decode_audio', side_effect=AssertionError('must not decode')):
            for context in [
                {'context_phone_index': 0},
                {'context_text': 'a leaf', 'context_phone_index': 0},
                {'context_word_index': 1, 'context_phone_index': 0},
            ]:
                with self.subTest(context=context):
                    response = self.client.post('/api/phonetics/analyze', data={'text': 'leaf', **context},
                        files={'audio': ('practice.wav', b'not decoded', 'audio/wav')})
                    self.assertEqual(response.status_code, 422)
                    self.assertIn('ต้นฉบับ', response.json()['detail'])

    def test_invalid_phone_indices_and_word_mismatch_are_422_without_model_inference(self):
        context = {'words': [{'index': 0, 'text': 'leaf', 'ipa': 'liːf', 'phones': ['l', 'iː', 'f']}]}
        recording = self.recording_bytes(np.full(16000, 0.05))
        base = {'text': 'leaf', 'context_text': 'leaf', 'context_word_index': 0, 'context_phone_index': 0}
        with patch.object(analyzer, 'annotate_text', return_value=context), \
                patch.object(analyzer, '_recognize', side_effect=AssertionError('must not infer')):
            for change in [{'context_phone_index': -1}, {'context_phone_index': 3},
                           {'context_phone_index': 'not-an-integer'}, {'context_phone_index': '1.5'},
                           {'context_word_index': -1}, {'text': 'f'}]:
                with self.subTest(change=change):
                    response = self.client.post('/api/phonetics/analyze', data={**base, **change},
                        files={'audio': ('practice.wav', recording, 'audio/wav')})
                    self.assertEqual(response.status_code, 422, response.text[:200])

    def test_portable_demo_assets_and_ranges_work_without_old_training_runs(self):
        with tempfile.TemporaryDirectory(prefix='egl-static-demo-') as temporary:
            root = Path(temporary).resolve()
            public = root / 'speech-training/demo-assets'
            audio = self.recording_bytes(np.zeros(3200))
            for variant in ['baseline', 'candidate', 'practice']:
                directory = public / 'audio' / variant
                directory.mkdir(parents=True)
                (directory / 'tts-005.wav').write_bytes(audio)
            (public / 'demo-data.json').write_text('{"schema_version": 1, "pairs": []}')
            (public / 'demo-data.js').write_text('globalThis.EGL_DEMO_DATA = {"schema_version": 1};')
            (root / 'app').mkdir()
            for name in ['sound-foundations.js', 'vowel-pairs.js', 'vowel-audio.js', 'pronunciation-videos.js', 'articulation-images.js', 'spelling-guide.js', 'spelling-feedback.js', 'word-audio.js']:
                (root / 'app' / name).write_text('globalThis.TEST_PUBLIC_HELPER = true;')
            self.assertFalse((root / 'speech-training/runs').exists())
            with patch.object(server, 'ROOT', root):
                for variant in ['baseline', 'candidate', 'practice']:
                    url = '/speech-training/demo-assets/audio/' + variant + '/tts-005.wav'
                    response = self.client.get(url)
                    self.assertEqual(response.status_code, 200, response.text[:100])
                    self.assertEqual(response.content, audio)
                    self.assertIn('audio/', response.headers['content-type'])
                    ranged = self.client.get(url, headers={'Range': 'bytes=0-15'})
                    self.assertEqual(ranged.status_code, 206)
                    self.assertEqual(ranged.content, audio[:16])
                response = self.client.get('/speech-training/demo-assets/demo-data.json')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {'schema_version': 1, 'pairs': []})
                response = self.client.get('/speech-training/demo-assets/demo-data.js')
                self.assertEqual(response.status_code, 200)
                self.assertIn('javascript', response.headers['content-type'])
                self.assertIn('EGL_DEMO_DATA', response.text)
                for name in ['sound-foundations.js', 'vowel-pairs.js', 'vowel-audio.js', 'pronunciation-videos.js', 'articulation-images.js', 'spelling-guide.js', 'spelling-feedback.js', 'word-audio.js']:
                    response = self.client.get('/app/' + name)
                    self.assertEqual(response.status_code, 200)
                    self.assertIn('javascript', response.headers['content-type'])
                self.assertEqual(self.client.get('/speech-training/runs/baseline-speaker/tts-005.wav').status_code, 404)

    def test_standalone_word_audio_and_public_metadata_are_served_with_ranges_and_containment(self):
        with tempfile.TemporaryDirectory(prefix='egl-word-assets-') as temporary:
            root = Path(temporary).resolve()
            words = root / 'speech-training/word-audio'
            words.mkdir(parents=True)
            audio = self.recording_bytes(np.full(6400, .1))
            (words / 'word-valid.wav').write_bytes(audio)
            for name, content in {'manifest.json': '{"schema_version":1}', 'ATTRIBUTION.txt': 'Standalone word credits', 'SHA256SUMS': 'Public hashes'}.items():
                (words / name).write_text(content)
            (words / 'private.json').write_text('{"private":true}')
            private = root / 'private.wav'
            private.write_bytes(audio)
            (words / 'escape.wav').symlink_to(private)
            with patch.object(server, 'ROOT', root):
                response = self.client.get('/speech-training/word-audio/word-valid.wav')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, audio)
                ranged = self.client.get('/speech-training/word-audio/word-valid.wav', headers={'Range': 'bytes=0-15'})
                self.assertEqual(ranged.status_code, 206)
                self.assertEqual(ranged.content, audio[:16])
                for name in ['manifest.json', 'ATTRIBUTION.txt', 'SHA256SUMS']:
                    self.assertEqual(self.client.get('/speech-training/word-audio/' + name).status_code, 200)
                for name in ['private.json', 'escape.wav', 'WORD.wav', 'nested/word-valid.wav', '../private.wav']:
                    self.assertEqual(self.client.get('/speech-training/word-audio/' + name).status_code, 404, name)
                self.assertEqual(self.client.get('/app/phone-examples.js').status_code, 404)

    def test_human_vowel_routes_allow_only_known_files_and_contained_metadata(self):
        with tempfile.TemporaryDirectory(prefix='egl-vowel-assets-') as temporary:
            root = Path(temporary).resolve()
            vowels = root / 'app/assets/vowels'
            vowels.mkdir(parents=True)
            content = b'OggS\x00 public fixture bytes'
            (vowels / 'vowel-i.ogg').write_bytes(content)
            (vowels / 'manifest.json').write_text('{"schema_version":1}')
            (vowels / 'ATTRIBUTION.md').write_text('# Human vowel credits')
            private = root / 'private.ogg'
            private.write_bytes(content)
            (vowels / 'vowel-ih.ogg').symlink_to(private)
            with patch.object(server, 'ROOT', root):
                response = self.client.get('/app/assets/vowels/vowel-i.ogg')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.content, content)
                self.assertIn('ogg', response.headers['content-type'])
                ranged = self.client.get('/app/assets/vowels/vowel-i.ogg', headers={'Range': 'bytes=0-3'})
                self.assertEqual(ranged.status_code, 206)
                self.assertEqual(ranged.content, b'OggS')
                for name in ['manifest.json', 'ATTRIBUTION.md']:
                    self.assertEqual(self.client.get('/app/assets/vowels/' + name).status_code, 200)
                for name in ['vowel-ih.ogg', 'unknown.ogg', 'private.json', 'nested/vowel-i.ogg', '../private.ogg']:
                    self.assertEqual(self.client.get('/app/assets/vowels/' + name).status_code, 404, name)

    def test_demo_asset_allowlist_rejects_traversal_private_files_and_symlink_escape(self):
        with tempfile.TemporaryDirectory(prefix='egl-static-boundary-') as temporary:
            root = Path(temporary).resolve()
            public = root / 'speech-training/demo-assets'
            directory = public / 'audio/baseline'
            directory.mkdir(parents=True)
            private = root / 'private'
            private.mkdir()
            (private / 'outside.wav').write_bytes(b'private audio')
            (public / 'private.txt').write_text('not a public demo asset')
            (directory / 'tts-999.wav').symlink_to(private / 'outside.wav')
            with patch.object(server, 'ROOT', root):
                for url in [
                    '/speech-training/demo-assets/private.txt',
                    '/speech-training/demo-assets/audio/baseline/../../private.txt',
                    '/speech-training/demo-assets/audio/baseline/%2e%2e/%2e%2e/private.txt',
                    '/speech-training/demo-assets/audio/baseline/tts-999.wav',
                    '/speech-training/demo-assets/audio/unknown/tts-005.wav',
                    '/speech-training/demo-assets/audio/baseline/metadata.json',
                    '/speech-training/demo-assets/demo-data.js',
                    '/speech-training/models/phoneme-ctc/config.json',
                ]:
                    with self.subTest(url=url):
                        self.assertEqual(self.client.get(url).status_code, 404)

    def test_curated_articulation_images_and_attribution_are_served_from_a_fresh_root(self):
        names = ['b', 'd', 'eth', 'f', 'g', 'i', 'ih', 'k', 'l', 'm',
                 'n', 'ng', 'p', 's', 'sh', 't', 'theta', 'v', 'z', 'zh']
        with tempfile.TemporaryDirectory(prefix='egl-articulation-public-') as temporary:
            root = Path(temporary).resolve()
            images = root / 'app/assets/articulation'
            images.mkdir(parents=True)
            expected = {}
            for name in names:
                expected[name] = ('<svg xmlns="http://www.w3.org/2000/svg"><title>'
                                  + name + '</title></svg>').encode('utf-8')
                (images / (name + '.svg')).write_bytes(expected[name])
            (images / 'ATTRIBUTION.json').write_text('{"license": "CC BY-SA", "images": 20}', encoding='utf-8')
            (images / 'ATTRIBUTION.md').write_text('# Image attribution\nLicensed educational diagrams.\n', encoding='utf-8')
            with patch.object(server, 'ROOT', root):
                for name in names:
                    with self.subTest(name=name):
                        response = self.client.get('/app/assets/articulation/' + name + '.svg')
                        self.assertEqual(response.status_code, 200, response.text[:100])
                        self.assertEqual(response.content, expected[name])
                        self.assertIn('image/svg+xml', response.headers['content-type'])
                attribution = self.client.get('/app/assets/articulation/ATTRIBUTION.json')
                self.assertEqual(attribution.status_code, 200)
                self.assertEqual(attribution.json(), {'license': 'CC BY-SA', 'images': 20})
                attribution = self.client.get('/app/assets/articulation/ATTRIBUTION.md')
                self.assertEqual(attribution.status_code, 200)
                self.assertEqual(attribution.text, '# Image attribution\nLicensed educational diagrams.\n')

    def test_articulation_allowlist_denies_unlisted_files_traversal_and_symlinks_to_private_svg(self):
        with tempfile.TemporaryDirectory(prefix='egl-articulation-boundary-') as temporary:
            root = Path(temporary).resolve()
            images = root / 'app/assets/articulation'
            images.mkdir(parents=True)
            private = root / 'private'
            private.mkdir()
            secret = b'<svg xmlns="http://www.w3.org/2000/svg"><title>private-secret</title></svg>'
            (private / 'secret.svg').write_bytes(secret)
            (private / 'secret.json').write_text('{"private": true}', encoding='utf-8')
            # Both targets are inside ROOT but outside the curated image folder;
            # a root-only containment check would incorrectly expose them.
            (images / 'p.svg').symlink_to(private / 'secret.svg')
            (images / 'ATTRIBUTION.json').symlink_to(private / 'secret.json')
            for filename in ['unlisted.svg', 'p.SVG', 'p.svg.json', 'ATTRIBUTION.txt', 'attribution.json']:
                (images / filename).write_bytes(secret)
            (images / 'nested').mkdir()
            (images / 'nested/p.svg').write_bytes(secret)
            with patch.object(server, 'ROOT', root):
                for url in [
                    '/app/assets/articulation/unlisted.svg',
                    '/app/assets/articulation/p.SVG',
                    '/app/assets/articulation/p.svg.json',
                    '/app/assets/articulation/ATTRIBUTION.txt',
                    '/app/assets/articulation/attribution.json',
                    '/app/assets/articulation/nested/p.svg',
                    '/app/assets/articulation/../../../private/secret.svg',
                    '/app/assets/articulation/%2e%2e/%2e%2e/%2e%2e/private/secret.svg',
                    '/app/assets/articulation/%2e%2e%2f%2e%2e%2f%2e%2e%2fprivate%2fsecret.svg',
                    '/app/assets/articulation/p.svg',
                    '/app/assets/articulation/ATTRIBUTION.json',
                    '/private/secret.svg',
                ]:
                    with self.subTest(url=url):
                        response = self.client.get(url)
                        self.assertEqual(response.status_code, 404)
                        self.assertNotIn(b'private-secret', response.content)

    @staticmethod
    def recording_bytes(audio, rate=16000):
        output = io.BytesIO()
        sf.write(output, np.asarray(audio, dtype=np.float32), rate, format='WAV', subtype='FLOAT')
        return output.getvalue()

    def normalize(self, data, name='recording.wav', mime='audio/wav', origin=None):
        return self.client.post('/api/phonetics/normalize',
            files={'audio': (name, data, mime)}, headers={'Origin': origin} if origin else {})

    def test_normalize_returns_seekable_pcm_with_sample_duration_and_no_model_call(self):
        audio = (0.2 * np.sin(2 * np.pi * 220 * np.arange(8000) / 16000)).astype(np.float32)
        with patch.object(analyzer, 'analyze_waveform', side_effect=AssertionError('model must not run')), \
                patch.object(analyzer, '_load_model', side_effect=AssertionError('model must not load')), \
                patch.object(analyzer, 'annotate_text', side_effect=AssertionError('text engine must not run')):
            response = self.normalize(self.recording_bytes(audio), origin='null')
        self.assertEqual(response.status_code, 200, response.text[:200])
        self.assertEqual(response.headers['content-type'], 'audio/wav')
        self.assertEqual(int(response.headers['content-length']), len(response.content))
        self.assertEqual(response.content[:4], b'RIFF')
        self.assertEqual(int.from_bytes(response.content[4:8], 'little'), len(response.content) - 8)
        with wave.open(io.BytesIO(response.content), 'rb') as recording:
            self.assertEqual(recording.getnchannels(), 1)
            self.assertEqual(recording.getsampwidth(), 2)
            self.assertEqual(recording.getframerate(), 16000)
            self.assertEqual(recording.getnframes(), 8000)
        decoded, rate = sf.read(io.BytesIO(response.content), dtype='float32')
        np.testing.assert_allclose(decoded, audio, atol=4e-5)
        self.assertEqual(rate, 16000)
        self.assertEqual(float(response.headers['x-audio-duration']), len(decoded) / rate)
        self.assertEqual(int(response.headers['x-audio-samples']), len(decoded))
        self.assertEqual(response.headers['x-audio-sample-rate'], '16000')
        self.assertTrue(math.isfinite(float(response.headers['x-audio-rms-dbfs'])))
        exposed = response.headers['access-control-expose-headers'].lower()
        for name in ('x-audio-duration', 'x-audio-rms-dbfs', 'x-audio-samples'):
            self.assertIn(name, exposed)
        self.assertEqual(response.headers.get('cache-control'), 'no-store')

    def test_normalize_allows_silent_but_valid_playback_recording(self):
        response = self.normalize(self.recording_bytes(np.zeros(3200)))
        self.assertEqual(response.status_code, 200, response.text[:200])
        self.assertEqual(float(response.headers['x-audio-duration']), 0.2)
        self.assertTrue(math.isfinite(float(response.headers['x-audio-rms-dbfs'])))
        audio, _ = sf.read(io.BytesIO(response.content))
        self.assertEqual(len(audio), 3200)
        self.assertTrue(np.all(audio == 0))

    def test_normalize_rejects_empty_corrupt_no_frames_short_and_overlong_audio(self):
        empty_wav = io.BytesIO()
        with wave.open(empty_wav, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes(b'')
        bad_inputs = [b'', b'not an audio header', empty_wav.getvalue(),
                      self.recording_bytes(np.ones(1600) * 0.1),
                      self.recording_bytes(np.ones(16 * 16000) * 0.1)]
        for data in bad_inputs:
            with self.subTest(bytes=len(data)):
                response = self.normalize(data)
                self.assertEqual(response.status_code, 422, response.text[:200])

    def test_normalize_rejects_nonfinite_samples_and_oversized_upload(self):
        response = self.normalize(self.recording_bytes(np.full(8000, np.nan)))
        self.assertEqual(response.status_code, 422, response.text[:200])
        response = self.normalize(b'x' * (MAX_BYTES + 1))
        self.assertEqual(response.status_code, 413, response.text[:200])

    @unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg is required for recorder-container tests')
    def test_normalize_streaming_webm_without_duration_tags_recovers_frames(self):
        audio = 0.1 * np.sin(2 * np.pi * 300 * np.arange(16000) / 16000)
        # A pipe-written WebM lacks a seekable final duration header, matching
        # the relevant browser-recorder container behavior without using a mic.
        encoded = subprocess.run([shutil.which('ffmpeg'), '-hide_banner', '-loglevel', 'error',
            '-nostdin', '-i', 'pipe:0', '-c:a', 'libopus', '-f', 'webm', 'pipe:1'],
            input=self.recording_bytes(audio), capture_output=True, check=True, timeout=10).stdout
        response = self.normalize(encoded, 'recording.webm', 'audio/webm')
        self.assertEqual(response.status_code, 200, response.text[:200])
        decoded, sr = sf.read(io.BytesIO(response.content))
        self.assertEqual(sr, 16000)
        self.assertGreater(len(decoded), 15000)
        self.assertEqual(float(response.headers['x-audio-duration']), len(decoded) / sr)
        self.assertGreater(float(np.max(np.abs(decoded))), 0.01)

    def test_normalize_keeps_local_origin_restriction(self):
        response = self.normalize(self.recording_bytes(np.zeros(3200)), origin='https://example.com')
        self.assertEqual(response.status_code, 403)


if __name__ == '__main__':
    unittest.main()
