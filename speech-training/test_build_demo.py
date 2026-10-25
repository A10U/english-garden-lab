"""Static build integration checks requiring only the tracked public bundle."""
from __future__ import annotations

import json
import hashlib
from pathlib import Path
import re
import shutil
import tempfile
import unittest
import wave

from build_demo import build, PRIVATE_PATH, LOOPBACK_URL, MODEL_URL
from build_listen import build as build_listen
from build_word_audio import filename as word_filename, write_public as write_word_audio


class StaticDemoBuildTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "checkout"
        self.output = Path(self.temp.name) / "public"
        app = self.root / "app"
        app.mkdir(parents=True)
        self.landing = '<!doctype html><html><body><a href="app/index.html">Learn</a><a href="speech-training/listen.html">Listen</a></body></html>'
        (self.root / "index.html").write_text(self.landing)
        (app / "index.html").write_text('''<!doctype html><html><head>
<link rel="stylesheet" href="styles.css">
<script src="reference-audio.js" defer></script>
<script src="phonetic-data.js" defer></script>
<script src="phone-guide.js" defer></script>
<script src="sound-foundations.js" defer></script>
<script src="articulation-images.js" defer></script>
<script src="browser-phonetics.js" defer></script>
<script src="spelling-guide.js" defer></script>
<script src="spelling-feedback.js" defer></script>
<script src="word-audio.js" defer></script>
<script src="phonetics.js" defer></script><script src="app.js" defer></script>
</head><body><main>App</main></body></html>''')
        (app / "styles.css").write_text('body{color:#123}')
        (app / "app.js").write_text("globalThis.options={apiBase:'http://127.0.0.1:8766'};")
        (app / "phonetics.js").write_text("globalThis.oldDefault=options.apiBase||'http://127.0.0.1:8766';")
        (app / "reference-audio.js").write_text("globalThis.EGL_REFERENCE_AUDIO={'private':'../speech-training/runs/secret.wav'};")
        (app / "phonetic-data.js").write_text('globalThis.EGL_PHONETIC_DATA={};')
        (app / 'browser-phonetics.js').write_text('globalThis.EGLBrowserPhonetics={};')
        (app / 'browser-phonetics-worker.js').write_text("importScripts('vendor/onnxruntime/ort.wasm.min.js','phonetic-alignment.js','browser-phoneme-model.js');")
        (app / 'browser-phoneme-model.js').write_text('globalThis.EGLBrowserPhonemeModel=' + json.dumps({'url': MODEL_URL}) + ';')
        (app / 'phonetic-alignment.js').write_text('globalThis.EGLPhoneticAlignment={};')
        (app / 'phone-guide.js').write_text('globalThis.EGLPhoneGuide={};')
        (app / 'sound-foundations.js').write_text('globalThis.EGLSoundFoundations={};')
        (app / 'articulation-images.js').write_text('globalThis.EGLArticulationImages={};')
        credits = app / 'assets/articulation'
        credits.mkdir(parents=True)
        (credits / 'ATTRIBUTION.json').write_text('{"images":[]}')
        (credits / 'ATTRIBUTION.md').write_text('# Articulation image credits\n')
        (app / 'spelling-guide.js').write_text('globalThis.EGLSpellingGuide={};')
        (app / 'spelling-feedback.js').write_text('globalThis.EGLSpellingFeedback={};')
        (app / 'phone-examples.js').write_text('globalThis.OBSOLETE_PHONE_CUTS=[];')
        vendor = app / 'vendor/onnxruntime'
        shutil.copytree(Path(__file__).resolve().parent.parent / 'app/vendor/onnxruntime', vendor)
        for folder in ('tests', 'node_modules', '.private'):
            (app / folder).mkdir()
            (app / folder / 'excluded.js').write_text('private fixture file')
        (app / 'private.log').write_text('private log')
        (app / 'README.md').write_text('not runtime')
        training = self.root / "speech-training"
        training.mkdir()
        (training / 'listen.html').write_text('''<!doctype html><html><head>
<link rel="stylesheet" href="../app/styles.css"></head><body>
<script id="trial-data" type="application/json">{"model":"/Users/private/model","pairs":[]}</script>
<script src="../app/phone-guide.js"></script>
<script src="../app/sound-foundations.js"></script>
<script src="../app/articulation-images.js"></script>
<script src="../app/browser-phonetics.js"></script>
<script src="../app/spelling-guide.js"></script>
<script src="../app/spelling-feedback.js"></script>
<script src="../app/word-audio.js"></script>
<script src="../app/phonetics.js"></script>
<script>mount({apiBase:'http://127.0.0.1:8766'});</script></body></html>''')
        (training / 'secret.py').write_text('not public')
        shutil.copytree(Path(__file__).parent / 'demo-assets', training / 'demo-assets')
        self.words = training / 'word-audio'
        self.words.mkdir()
        self.word_name = word_filename('leaf')
        with wave.open(str(self.words / self.word_name), 'wb') as audio:
            audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(24000)
            audio.writeframes(b'\x00\x20' * 9600)
        self.word_records = {'leaf': {
            'text': 'leaf', 'url': '../speech-training/word-audio/' + self.word_name,
            'duration_seconds': .4, 'audio_sha256': hashlib.sha256((self.words / self.word_name).read_bytes()).hexdigest(),
            'sample_rate': 24000, 'samples': 9600, 'channels': 1, 'bits_per_sample': 16, 'standalone': True,
            'reference': {'text': 'leaf', 'accent': 'en-us', 'ipa': 'liːf',
                'words': [{'index': 0, 'text': 'leaf', 'ipa': 'liːf', 'phones': ['l', 'iː', 'f']}],
                'analysis_type': 'text_pronunciation_reference', 'audio_analyzed': False},
        }}
        self.write_words()

    def write_words(self):
        write_word_audio(self.words, self.root / 'app/word-audio.js', self.word_records)

    def test_build_requires_only_public_subtrees_and_generates_demo_globals(self):
        summary = build(self.root, self.output)
        self.assertEqual(summary['pairs'], 24)
        self.assertEqual(summary['recordings'], 62)
        self.assertEqual(summary['standalone_words'], 1)
        self.assertEqual((self.output / 'index.html').read_text(), self.landing)
        self.assertTrue((self.output / 'speech-training/demo-assets/demo-data.js').is_file())
        self.assertIn('globalThis.EGL_DEMO_DATA=', (self.output / 'speech-training/demo-assets/demo-data.js').read_text())
        for page in ('app/index.html', 'speech-training/listen.html'):
            text = (self.output / page).read_text()
            self.assertLess(text.index('id="egl-demo-runtime"'), text.index('demo-data.js'))
            self.assertLess(text.index('demo-data.js'), text.index('src="' + ('../app/' if page.startswith('speech-training') else '') + 'phonetics.js"'))
            self.assertLess(text.index('browser-phonetics.js'), text.index('src="' + ('../app/' if page.startswith('speech-training') else '') + 'phonetics.js"'))
            self.assertLess(text.index('phone-guide.js'), text.index('sound-foundations.js'))
            self.assertLess(text.index('sound-foundations.js'), text.index('articulation-images.js'))
            self.assertLess(text.index('articulation-images.js'), text.index('src="' + ('../app/' if page.startswith('speech-training') else '') + 'phonetics.js"'))
            self.assertLess(text.index('sound-foundations.js'), text.index('src="' + ('../app/' if page.startswith('speech-training') else '') + 'phonetics.js"'))
            self.assertLess(text.index('spelling-guide.js'), text.index('src="' + ('../app/' if page.startswith('speech-training') else '') + 'phonetics.js"'))
            self.assertLess(text.index('spelling-guide.js'), text.index('word-audio.js'))
            self.assertLess(text.index('spelling-guide.js'), text.index('spelling-feedback.js'))
            self.assertLess(text.index('spelling-feedback.js'), text.index('src="' + ('../app/' if page.startswith('speech-training') else '') + 'phonetics.js"'))
            self.assertLess(text.index('word-audio.js'), text.index('src="' + ('../app/' if page.startswith('speech-training') else '') + 'phonetics.js"'))
            self.assertNotIn('phone-examples.js', text)
            self.assertIn('id="egl-hosted-demo-notice"', text)
            self.assertIn("connect-src 'self' https://huggingface.co https://*.hf.co;", text)
            self.assertIn("worker-src 'self' blob:;", text)
            self.assertIn('318 MB', text)
            self.assertNotRegex(text, LOOPBACK_URL)
        for name in ('sound-foundations.js', 'articulation-images.js', 'assets/articulation/ATTRIBUTION.json', 'assets/articulation/ATTRIBUTION.md',
                     'spelling-guide.js', 'spelling-feedback.js', 'word-audio.js', 'browser-phonetics.js', 'browser-phonetics-worker.js', 'browser-phoneme-model.js', 'phonetic-alignment.js',
                     'vendor/onnxruntime/ort.wasm.min.js', 'vendor/onnxruntime/ort-wasm-simd-threaded.mjs',
                     'vendor/onnxruntime/ort-wasm-simd-threaded.wasm', 'vendor/onnxruntime/LICENSE.txt',
                     'vendor/onnxruntime/ThirdPartyNotices.txt'):
            self.assertEqual((self.output / 'app' / name).read_bytes(), (self.root / 'app' / name).read_bytes())
        text = (self.output / 'speech-training/listen.html').read_text()
        payload = json.loads(re.search(r'<script id="trial-data"[^>]*>(.*?)</script>', text, re.S)[1])
        self.assertEqual(len(payload['pairs']), 24)
        self.assertEqual(payload['settings_differences'], [])
        self.assertTrue(payload['public_demo'])
        self.assertNotIn('model', payload)
        self.assertNotIn('candidate_adapter', payload)
        self.assertIn('apiBase:null', text)
        self.assertIn('demo-assets/audio/candidate/', (self.output / 'app/reference-audio.js').read_text())
        self.assertFalse((self.output / 'app/tests').exists())
        self.assertFalse((self.output / 'app/node_modules').exists())
        self.assertFalse((self.output / 'speech-training/secret.py').exists())
        self.assertFalse((self.output / 'app/phone-examples.js').exists())
        for name in ['manifest.json', 'ATTRIBUTION.txt', 'SHA256SUMS', self.word_name]:
            self.assertEqual((self.output / 'speech-training/word-audio' / name).read_bytes(), (self.words / name).read_bytes())
        for path in self.output.rglob('*'):
            if path.is_file() and path.suffix in ('.html', '.js', '.json', '.txt', '.css'):
                self.assertNotRegex(path.read_text(), PRIVATE_PATH, str(path))
                self.assertNotRegex(path.read_text(), LOOPBACK_URL, str(path))

    def test_repeated_build_is_deterministic(self):
        build(self.root, self.output)
        first = (self.output / '.egl-demo-build.json').read_bytes()
        build(self.root, self.output)
        self.assertEqual(first, (self.output / '.egl-demo-build.json').read_bytes())

    def test_stale_authoring_link_fails_before_output_writes(self):
        (self.root / 'index.html').write_text('<html><body><a href="SDLC/private.json">private</a></body></html>')
        with self.assertRaisesRegex(ValueError, 'Private/authoring path'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_static_asset_and_unowned_output_are_rejected(self):
        (self.root / 'index.html').write_text('<html><body><img src="missing.png"></body></html>')
        with self.assertRaisesRegex(ValueError, 'Missing public link'):
            build(self.root, self.output)
        (self.root / 'index.html').write_text(self.landing)
        self.output.mkdir()
        (self.output / 'private.txt').write_text('do not replace')
        with self.assertRaisesRegex(ValueError, 'no demo build marker'):
            build(self.root, self.output)
        self.assertEqual((self.output / 'private.txt').read_text(), 'do not replace')

    def test_external_model_must_be_pinned_to_curated_checkpoint(self):
        metadata = self.root / 'app/browser-phoneme-model.js'
        metadata.write_text('globalThis.EGLBrowserPhonemeModel=' + json.dumps({'url': MODEL_URL.replace('/resolve/c69750f5043e5e1f8a71ab95dd3b98338c280c92/', '/resolve/main/')}) + ';')
        with self.assertRaisesRegex(ValueError, 'pinned public ONNX model URL'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_worker_binary_fails_before_writing(self):
        (self.root / 'app/vendor/onnxruntime/ort-wasm-simd-threaded.wasm').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing browser phoneme runtime asset'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_spelling_guide_fails_before_writing(self):
        (self.root / 'app/spelling-guide.js').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing browser phoneme runtime asset: app/spelling-guide.js'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_spelling_feedback_fails_before_writing(self):
        (self.root / 'app/spelling-feedback.js').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing browser phoneme runtime asset: app/spelling-feedback.js'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_word_audio_lookup_fails_before_writing(self):
        (self.root / 'app/word-audio.js').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing or symlinked standalone word lookup'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_only_manifest_verified_word_files_are_published(self):
        (self.words / 'private.wav').write_bytes(b'not a public recording')
        (self.words / 'local-recording.json').write_text('{"private":true}')
        build(self.root, self.output)
        self.assertEqual({path.name for path in (self.output / 'speech-training/word-audio').iterdir()},
                         {'manifest.json', 'ATTRIBUTION.txt', 'SHA256SUMS', self.word_name})

    def test_word_audio_hash_duration_and_isolated_reference_are_checked(self):
        audio = self.words / self.word_name
        original = audio.read_bytes()
        audio.write_bytes(original[:-1] + bytes([original[-1] ^ 1]))
        with self.assertRaisesRegex(ValueError, 'audio hash mismatch'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())
        audio.write_bytes(original)
        self.word_records['leaf']['duration_seconds'] = .6
        self.write_words()
        with self.assertRaisesRegex(ValueError, 'duration mismatch'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())
        self.word_records['leaf']['duration_seconds'] = .4
        self.word_records['leaf']['reference']['text'] = 'different word'
        self.write_words()
        with self.assertRaisesRegex(ValueError, 'isolated text-pronunciation reference'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_word_lookup_must_equal_manifest_and_credit_checksums_must_be_complete(self):
        lookup = self.root / 'app/word-audio.js'
        lookup.write_text(lookup.read_text().replace('"standalone": true', '"standalone": false'))
        with self.assertRaisesRegex(ValueError, 'lookup differs'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())
        self.write_words()
        sums = self.words / 'SHA256SUMS'
        sums.write_text('\n'.join(line for line in sums.read_text().splitlines() if not line.endswith('  ATTRIBUTION.txt')) + '\n')
        with self.assertRaisesRegex(ValueError, 'checksum coverage mismatch'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_symlinked_word_audio_cannot_leave_its_public_directory(self):
        audio = self.words / self.word_name
        outside = self.root / 'private.wav'
        outside.write_bytes(audio.read_bytes()); audio.unlink(); audio.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'inside its public directory'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_sound_foundations_fails_before_writing(self):
        (self.root / 'app/sound-foundations.js').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing browser phoneme runtime asset: app/sound-foundations.js'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_articulation_image_module_fails_before_writing(self):
        (self.root / 'app/articulation-images.js').unlink()
        with self.assertRaisesRegex(ValueError, 'Missing browser phoneme runtime asset: app/articulation-images.js'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())

    def test_image_credits_are_required_before_writing(self):
        for name in ('ATTRIBUTION.json', 'ATTRIBUTION.md'):
            with self.subTest(name=name):
                credit = self.root / 'app/assets/articulation' / name
                original = credit.read_bytes()
                credit.unlink()
                with self.assertRaisesRegex(ValueError, 'Missing public articulation credit asset:'):
                    build(self.root, self.output)
                self.assertFalse(self.output.exists())
                credit.write_bytes(original)

    def test_listening_template_loads_spelling_and_complete_word_audio_before_widget(self):
        training = self.root / 'speech-training'
        paths = [training / name for name in ('baseline.json', 'candidate.json', 'training.json')]
        for metadata, variant in zip(paths[:2], ('baseline', 'candidate')):
            metadata.write_text(json.dumps({'results': [{
                'id': 'example', 'text': 'A leaf.', 'status': 'ok',
                'file': f'demo-assets/audio/{variant}/tts-001.wav',
            }]}))
        paths[2].write_text('{}')
        missing = training / 'not-needed.json'
        html = build_listen(*paths, self.output / 'listen.html', phonetics_data=missing, reference_data=missing)
        scripts = [url.rsplit('/', 1)[-1] for url in re.findall(r'<script src="([^"]+)"', html)]
        self.assertLess(scripts.index('phone-guide.js'), scripts.index('sound-foundations.js'))
        self.assertLess(scripts.index('sound-foundations.js'), scripts.index('articulation-images.js'))
        self.assertLess(scripts.index('articulation-images.js'), scripts.index('phonetics.js'))
        self.assertLess(scripts.index('sound-foundations.js'), scripts.index('phonetics.js'))
        self.assertLess(scripts.index('spelling-guide.js'), scripts.index('word-audio.js'))
        self.assertLess(scripts.index('spelling-guide.js'), scripts.index('spelling-feedback.js'))
        self.assertLess(scripts.index('spelling-feedback.js'), scripts.index('phonetics.js'))
        self.assertLess(scripts.index('word-audio.js'), scripts.index('phonetics.js'))
        self.assertNotIn('phone-examples.js', scripts)
        self.assertNotIn('__SPELLING_GUIDE_JS__', html)
        self.assertNotIn('__SPELLING_FEEDBACK_JS__', html)
        self.assertNotIn('__WORD_AUDIO_JS__', html)
        self.assertNotIn('__SOUND_FOUNDATIONS_JS__', html)
        self.assertNotIn('__ARTICULATION_IMAGES_JS__', html)

    def test_vendor_private_literal_exception_requires_exact_upstream_hash(self):
        runtime = self.root / 'app/vendor/onnxruntime/ort-wasm-simd-threaded.mjs'
        runtime.write_bytes(runtime.read_bytes() + b'\n// /Users/private/changed-runtime\n')
        with self.assertRaisesRegex(ValueError, 'Vendored runtime integrity check failed'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
