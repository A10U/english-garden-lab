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
                self.assertEqual(self.client.get('/speech-training/runs/baseline-speaker/tts-005.wav').status_code, 404)

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
