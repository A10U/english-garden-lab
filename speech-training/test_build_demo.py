"""Static build integration checks requiring only the tracked public bundle."""
from __future__ import annotations

import json
from pathlib import Path
import re
import shutil
import tempfile
import unittest

from build_demo import build, PRIVATE_PATH, LOOPBACK_URL, MODEL_URL


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
<script src="browser-phonetics.js" defer></script>
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
<script src="../app/browser-phonetics.js"></script>
<script src="../app/phonetics.js"></script>
<script>mount({apiBase:'http://127.0.0.1:8766'});</script></body></html>''')
        (training / 'secret.py').write_text('not public')
        shutil.copytree(Path(__file__).parent / 'demo-assets', training / 'demo-assets')

    def test_build_requires_only_public_subtrees_and_generates_demo_globals(self):
        summary = build(self.root, self.output)
        self.assertEqual(summary['pairs'], 24)
        self.assertEqual(summary['recordings'], 62)
        self.assertEqual((self.output / 'index.html').read_text(), self.landing)
        self.assertTrue((self.output / 'speech-training/demo-assets/demo-data.js').is_file())
        self.assertIn('globalThis.EGL_DEMO_DATA=', (self.output / 'speech-training/demo-assets/demo-data.js').read_text())
        for page in ('app/index.html', 'speech-training/listen.html'):
            text = (self.output / page).read_text()
            self.assertLess(text.index('id="egl-demo-runtime"'), text.index('demo-data.js'))
            self.assertLess(text.index('demo-data.js'), text.index('src="' + ('../app/' if page.startswith('speech-training') else '') + 'phonetics.js"'))
            self.assertLess(text.index('browser-phonetics.js'), text.index('src="' + ('../app/' if page.startswith('speech-training') else '') + 'phonetics.js"'))
            self.assertIn('id="egl-hosted-demo-notice"', text)
            self.assertIn("connect-src 'self' https://huggingface.co https://*.hf.co;", text)
            self.assertIn("worker-src 'self' blob:;", text)
            self.assertIn('318 MB', text)
            self.assertNotRegex(text, LOOPBACK_URL)
        for name in ('browser-phonetics.js', 'browser-phonetics-worker.js', 'browser-phoneme-model.js', 'phonetic-alignment.js',
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

    def test_vendor_private_literal_exception_requires_exact_upstream_hash(self):
        runtime = self.root / 'app/vendor/onnxruntime/ort-wasm-simd-threaded.mjs'
        runtime.write_bytes(runtime.read_bytes() + b'\n// /Users/private/changed-runtime\n')
        with self.assertRaisesRegex(ValueError, 'Vendored runtime integrity check failed'):
            build(self.root, self.output)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
