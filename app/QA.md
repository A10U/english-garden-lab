# Verification

Checks for the portable App and Speech demo:

- JavaScript unit and DOM integration suite: 107 passed.
- Python engine, API, reference-audio and exporter tests: 40 passed before the static-builder tests were added.
- Static-builder and exporter focused suite: 10 passed.
- All 62 curated WAV files verified against SHA256SUMS.
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
