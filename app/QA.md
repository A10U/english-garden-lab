# Verification

Checks for the portable App and Speech demo:

- JavaScript unit and DOM integration suite: 239 passed.
- Full Python engine, API, reference-audio, exporter and static-builder suite: 80 passed.
- Browser client, alignment and hosted learner dispatch have regression coverage for cancellation, PCM resampling and separation from cached AI results.
- All 62 sentence WAVs and 210 complete standalone word WAVs verified against manifests, PCM headers, duration, and SHA256SUMS.
- Word examples start at zero and play the complete recording. Learner playback uses the complete analyzed clip; there are no timestamp-based cut/stop timers.
- Spelling-to-sound groups, isolated word/phone targets, weak/strong forms, 53 sound foundations and 20 licensed articulation images have DOM/data regression coverage.
- Twelve whole human IPA vowel OGG recordings have source/creator/license credits, verified SHA256 and Vorbis timing/format metadata; all decode to finite, non-silent samples. Long-vowel and dictionary /e/ aliases retain truthful recorded symbols and explain their limits.
- Ten YouTube lesson IDs were checked against the original Rachel’s English creator pages. DOM tests cover click-only iframe creation, no autoplay, direct-link fallback, and closing videos when another sound, page audio, or microphone recording starts. Actual YouTube playback still needs a target-browser check.
- Vowel A/B comparisons wait for each full-file ended event before the gap and next sample. Tests cover pitch-preserving slow playback, target/cleanup cancellation, source accent/phone mismatches, and portable Speech paths.
- Per-phone and per-spelling-group percentages aggregate actual acoustic alignment operations, including inserted phones. Missing/ambiguous data and silent letters stay unassessed. Tests cover deletion versus silence, global/original phone indices, lowest-first suggestions, stop-sound word practice, stale score cleanup, and learner/AI source separation.
- Automatic transcription and independent acoustic checks were used to review standalone-word candidates. These checks do not replace human listening or establish native pronunciation quality.
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
