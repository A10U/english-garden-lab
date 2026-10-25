# Verification

Checks for the portable App and Speech demo:

- JavaScript unit and DOM integration suite: 138 passed.
- Full Python engine, API, reference-audio, exporter and static-builder suite: 47 passed.
- Browser client, alignment and hosted learner dispatch have regression coverage for cancellation, PCM resampling and separation from cached AI results.
- All 62 curated WAV files verified against SHA256SUMS.
- Actual q8 acoustic model ran through ONNX Runtime Web WASM on a sample WAV; all 119 argmax frames agreed with native ONNX Runtime. The same audio kept the same recognized phonemes when the target text changed, while the comparison percentage changed.
- Browser-model weights stay outside the repository; the worker downloads pinned, SHA256-verified weights only on explicit analysis. Audio is not uploaded.
- Landing page, App, Speech, demo data script and a sample WAV served successfully over local HTTP.
- Generated demo validates its relative asset links and rejects private paths, excluded authoring folders and loopback URLs.

Run the checks from the repository root:

```sh
npm ci --prefix app
npm test --prefix app
python3 -m unittest discover -s speech-training -p 'test_demo_assets.py'
python3 -m unittest discover -s speech-training -p 'test_build_demo.py'
python3 speech-training/build_demo.py
```

The full Python suite requires the local-service dependencies described in the Speech Training README.

These checks cover code and HTTP delivery. Real-browser microphone capture, speaker playback and mobile layout still require a manual check on the target browser. No learner study or established improvement in voice naturalness is claimed by these checks.
