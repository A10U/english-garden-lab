#!/usr/bin/env python3
"""Generate complete standalone English words with the already-installed voice.

No downloads, playback, trimming, sentence extraction, or new training occurs.
Use --words leaf root green for a first batch; omit --words for runtime vocabulary.
Public outputs contain no local model/data/run paths or original corpus audio.
"""
from __future__ import annotations

import argparse
from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import random
import re
import time
import sys
import wave


WORD = re.compile(r"[a-z]+(?:'[a-z]+)*|\d+(?:[.,]\d+)*", re.I)
CURATED_VARIANTS = {
    'the': {'ipa': 'ðiː', 'phones': ['ð', 'iː'], 'variant': 'strong_form',
        'source': 'https://www.oxfordlearnersdictionaries.com/definition/english/the',
        'note': 'คำเดี่ยวนี้เลือกเสียงเน้น /ðiː/ ตาม Oxford Learner’s Dictionaries; รูปเบา /ðə/ ใช้ได้ในประโยค ค่านี้เป็นตัวเลือกที่ตรวจจากพจนานุกรม ไม่ใช่ผล eSpeak ที่แก้ชื่อให้เหมือนเดิม'},
    'been': {'ipa': 'biːn', 'phones': ['b', 'iː', 'n'], 'variant': 'long_vowel_variant',
        'source': 'https://www.oxfordlearnersdictionaries.com/definition/english/been',
        'note': 'คำเดี่ยวนี้เลือกการออกเสียง /biːn/ ที่พจนานุกรมยอมรับ; /bɪn/ ก็เป็นอีกรูปที่ใช้ได้ ไม่ควรตัดสินว่ารูปใดผิดจากความยาวสระเพียงอย่างเดียว'},
}
ATTRIBUTION = """Standalone AI word recordings — English Garden Lab

These are complete newly synthesized words, not cuts from sentences or copies
of the original training recordings. Voice: Qwen3-TTS 0.6B Base using Cori Samuel (Hi-Fi TTS speaker 92) as the
speaker reference. Most words use this project's LoRA; selected words use the
base voice clone. Each record identifies its generation_variant.

Training voice data: Hi-Fi Multi-Speaker English TTS Dataset (2021), by Evelina
Bakhturina, Vitaly Lavrukhin, Boris Ginsburg, and Yang Zhang.
Source: https://www.openslr.org/109/
License: Creative Commons Attribution 4.0 International (CC BY 4.0)
License URL: https://creativecommons.org/licenses/by/4.0/
Changes: selected speaker 92, selected training subset, resampled to 24 kHz,
trained a LoRA adapter, and synthesized these separate word utterances.

Base model Qwen3-TTS: https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base
Base model license: Apache-2.0. Generation uses local MLX Audio / MLX-Tune.
The files have automatic waveform checks, not a human naturalness endorsement.
Pronunciation, stress, vowel quality and rhoticity depend on the generated voice.
"""


def normalize_word(value):
    if not isinstance(value, str):
        return None
    word = value.casefold().replace('’', "'")
    return word if WORD.fullmatch(word) else None


def collect_words(root):
    data = json.loads((root / 'speech-training/resources/phonetics.json').read_text())
    references = data.get('texts', data)
    found = {normalize_word(word['text']) for reference in references.values() for word in reference['words']}
    spelling = (root / 'app/spelling-guide.js').read_text()
    found.update(re.findall(r'^\s*([a-z]+):\s*\[\[', spelling, re.M))
    guide = (root / 'app/phone-guide.js').read_text()
    found.update(re.findall(r"^\s*'[^']+'\s*:\s*\[.*?,\s*'([a-z]+)'\],?\s*$", guide, re.M))
    found.discard(None)
    if len(found) < 150:
        raise ValueError('Runtime word collection is unexpectedly small')
    return sorted(found)


def filename(word):
    return 'word-' + hashlib.sha256(word.encode()).hexdigest()[:16] + '.wav'


def display_word(word):
    return {'i': 'I', 'ai': 'AI', 'mali': 'Mali'}.get(word, word)


def public_data(records):
    return {'schema_version': 1,
            'voice': 'Qwen3-TTS 0.6B Base, Hi-Fi TTS speaker 92 (Cori Samuel); per-word generation variants',
            'by_word': dict(sorted(records.items())),
            'attribution': [{'name': 'Hi-Fi Multi-Speaker English TTS Dataset',
                'authors': ['Evelina Bakhturina', 'Vitaly Lavrukhin', 'Boris Ginsburg', 'Yang Zhang'],
                'speaker': 'Cori Samuel (speaker 92)', 'source': 'https://www.openslr.org/109/',
                'license': 'CC BY 4.0', 'licenseURL': 'https://creativecommons.org/licenses/by/4.0/',
                'changes': 'Selected training subset, resampled to 24 kHz, trained a LoRA adapter, synthesized complete standalone words.'}],
            'limitations': ['Complete synthesized words, not sentence cuts or isolated phoneme recordings.',
                'Automatic waveform checks do not establish pronunciation or naturalness quality.']}


def isolated_reference(analyzer, text):
    reference = analyzer.annotate_text(text, 'en-us')
    reference['reference_context'] = 'isolated_word'
    reference['notes'] = ['IPA อ้างอิงของคำที่ออกเสียงเดี่ยว อาจต่างจากเสียงลดรูปเมื่ออยู่ในประโยค']
    curated = CURATED_VARIANTS.get(normalize_word(text))
    if curated:
        original = reference['words'][0]
        reference['reference_source'] = {'type': 'curated_dictionary_variant',
            'source': curated['source'], 'variant': curated['variant'],
            'original_espeak_ipa': reference['ipa'], 'original_espeak_phones': original['phones']}
        reference['ipa'] = curated['ipa']
        reference['words'] = [{**original, 'ipa': curated['ipa'], 'phones': curated['phones'].copy()}]
        reference['notes'].append(curated['note'])
    return reference


def write_public(directory, javascript, records):
    data = public_data(records)
    encoded = json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
    (directory / 'manifest.json').write_text(encoded + '\n')
    (directory / 'ATTRIBUTION.txt').write_text(ATTRIBUTION)
    javascript.write_text('/* Complete standalone AI words; credits in speech-training/word-audio/ATTRIBUTION.txt. */\n'
        + 'globalThis.EGL_WORD_AUDIO = ' + encoded.replace('<', '\\u003c') + ';\n')
    names = ['manifest.json', 'ATTRIBUTION.txt'] + [filename(word) for word in sorted(records)]
    (directory / 'SHA256SUMS').write_text(''.join(hashlib.sha256((directory / name).read_bytes()).hexdigest()
        + '  ' + name + '\n' for name in names))


def verify_public(directory):
    """Check the portable public bundle using only Python's standard library."""
    for name in ('manifest.json', 'ATTRIBUTION.txt', 'SHA256SUMS'):
        if (directory / name).is_symlink():
            raise ValueError('Standalone bundle metadata must not be symlinked')
    data = json.loads((directory / 'manifest.json').read_text())
    if data.get('schema_version') != 1 or not isinstance(data.get('by_word'), dict):
        raise ValueError('Malformed standalone word manifest')
    expected = {'manifest.json', 'ATTRIBUTION.txt'}
    for word, record in data['by_word'].items():
        name = filename(word)
        if (normalize_word(word) != word or normalize_word(record.get('text')) != word
                or record.get('url') != '../speech-training/word-audio/' + name or record.get('standalone') is not True):
            raise ValueError('Invalid standalone word identity or URL')
        reference = record.get('reference', {})
        if (reference.get('text') != record.get('text') or reference.get('accent') != 'en-us'
                or reference.get('analysis_type') != 'text_pronunciation_reference'
                or reference.get('audio_analyzed') is not False
                or len(reference.get('words', [])) != 1
                or reference['words'][0].get('index') != 0
                or normalize_word(reference['words'][0].get('text')) != word
                or not isinstance(reference['words'][0].get('phones'), list)
                or not reference['words'][0]['phones']
                or any(not isinstance(phone, str) or not phone for phone in reference['words'][0]['phones'])):
            raise ValueError('Missing isolated-word pronunciation reference')
        path = directory / name
        if not path.is_file() or path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != record['audio_sha256']:
            raise ValueError('Standalone word audio hash mismatch: ' + word)
        with wave.open(str(path)) as audio:
            rate, count = audio.getframerate(), audio.getnframes()
            if (audio.getnchannels(), rate, audio.getsampwidth(), audio.getcomptype()) != (1, 24000, 2, 'NONE'):
                raise ValueError('Standalone audio must be mono 24 kHz PCM16')
            if count != record.get('samples') or rate != record.get('sample_rate') or record.get('channels') != 1 or record.get('bits_per_sample') != 16:
                raise ValueError('Standalone WAV metadata mismatch')
            if not math.isclose(count / rate, record['duration_seconds'], rel_tol=0, abs_tol=1e-9) or not .25 <= count / rate <= 6:
                raise ValueError('Standalone WAV duration mismatch')
            values = array('h', audio.readframes(count))
            if len(values) != count:
                raise ValueError('Standalone WAV has incomplete PCM frames')
            if sys.byteorder != 'little':
                values.byteswap()
            peak = max(abs(value) for value in values) / 32768
            rms = math.sqrt(sum(value * value for value in values) / len(values)) / 32768
            if peak < .005 or rms < 10 ** (-65 / 20):
                raise ValueError('Silent or inaudible standalone WAV')
        expected.add(name)
    checksums = {}
    for line in (directory / 'SHA256SUMS').read_text().splitlines():
        digest, name = line.split('  ', 1)
        if name in checksums or name not in expected or hashlib.sha256((directory / name).read_bytes()).hexdigest() != digest:
            raise ValueError('Standalone bundle checksum mismatch')
        checksums[name] = digest
    if set(checksums) != expected:
        raise ValueError('Standalone bundle checksum coverage mismatch')
    return {'words': len(data['by_word']), 'audio_bytes': sum((directory / filename(word)).stat().st_size for word in data['by_word'])}


def generate(root, words, output, javascript, *, temperature=.7, conditioning='speaker', base_seed=3407):
    output.mkdir(parents=True, exist_ok=True)
    existing = output / 'manifest.json'
    records = json.loads(existing.read_text())['by_word'] if existing.is_file() else {}
    from phonetic_engine import PhoneticAnalyzer
    analyzer = PhoneticAnalyzer()
    backfilled = False
    for key, record in records.items():
        if ('reference' not in record or key in CURATED_VARIANTS
                and record['reference'].get('reference_source', {}).get('type') != 'curated_dictionary_variant'):
            record['reference'] = isolated_reference(analyzer, record['text'])
            backfilled = True
    if backfilled:
        write_public(output, javascript, records)
    if records:
        verify_public(output)
    pending = [word for word in words if word not in records]
    if not pending:
        write_public(output, javascript, records)
        return verify_public(output)
    # Offline flags precede imports of every model loader.
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_tune import FastTTSModel
    from synthesize import load_adapter
    model = root / 'speech-training/models/qwen3-tts-0.6b-base-8bit'
    run = root / 'speech-training/runs/qwen3-hifi92-lora-v1'
    result = json.loads((run / 'result.json').read_text())
    adapter = run / result['suggested_adapter']
    dataset = root / 'speech-training/data'
    reference = json.loads((dataset / 'dataset-info.json').read_text())['reference']
    ref_audio = dataset / reference['audio']
    for required in (model, adapter, ref_audio):
        if not required.exists():
            raise ValueError('Required local generation input is missing')
    wrapper, _ = FastTTSModel.from_pretrained(str(model.resolve()))
    _, verified = load_adapter(wrapper, adapter, FastTTSModel)
    if not verified['verified']:
        raise ValueError('LoRA weights were not verified')
    FastTTSModel.for_inference(wrapper)
    native = wrapper.full_model
    if native is None or getattr(native.config, 'tts_model_type', 'base') != 'base':
        raise ValueError('Expected the local Qwen3-TTS Base generator')
    native.eval()
    settings = dict(lang_code='english', max_tokens=72, temperature=temperature, top_k=50,
                    top_p=1., repetition_penalty=1.5, stream=False, split_pattern='')
    for number, word in enumerate(pending, 1):
        seed = base_seed + int(hashlib.sha256(word.encode()).hexdigest()[:6], 16)
        random.seed(seed); np.random.seed(seed); mx.random.seed(seed)
        text = display_word(word)
        spoken = 'Five' if word == '5' else text[:1].upper() + text[1:]
        tick = time.perf_counter()
        chunks, rates, tokens = [], [], []
        for result in native.generate(text=spoken + '.', ref_audio=str(ref_audio.resolve()),
                ref_text=reference['text'] if conditioning == 'icl' else None, verbose=False, **settings):
            mx.eval(result.audio)
            chunks.append(np.asarray(result.audio, dtype=np.float32).reshape(-1))
            rates.append(int(result.sample_rate)); tokens.append(int(result.token_count))
        if not chunks or set(rates) != {24000} or any(count >= settings['max_tokens'] for count in tokens):
            raise ValueError('Empty, wrong-rate or potentially truncated word: ' + word)
        audio = np.concatenate(chunks)
        if not audio.size or not np.isfinite(audio).all():
            raise ValueError('Empty or nonfinite waveform: ' + word)
        duration = audio.size / 24000
        peak = float(np.max(np.abs(audio)))
        rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
        if not .25 <= duration <= 6 or not .005 <= peak <= 1 or rms < 10 ** (-65 / 20):
            raise ValueError('Invalid duration, amplitude or silence: ' + word)
        path = output / filename(word)
        # Quantize the complete waveform to PCM16, without clipping, trimming,
        # normalization, fade editing, sentence extraction, or added padding.
        sf.write(str(path), audio, 24000, subtype='PCM_16')
        records[word] = {'text': text, 'url': '../speech-training/word-audio/' + path.name,
            'duration_seconds': duration, 'audio_sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
            'sample_rate': 24000, 'samples': int(audio.size), 'channels': 1,
            'bits_per_sample': 16, 'standalone': True,
            'reference': isolated_reference(analyzer, text), 'generation_variant': 'lora_' + conditioning}
        write_public(output, javascript, records)
        print(f'{number}/{len(pending)} {word}: {duration:.3f}s, peak={peak:.4f}, generation={time.perf_counter()-tick:.2f}s', flush=True)
        mx.clear_cache()
    return verify_public(output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--words', nargs='+')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--temperature', type=float, default=.7)
    parser.add_argument('--conditioning', choices=['speaker', 'icl'], default='speaker')
    parser.add_argument('--seed', type=int, default=3407)
    parser.add_argument('--candidate-dir', type=Path,
        help='Write unselected candidates beneath speech-training/runs; leave public files untouched')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    output = root / 'speech-training/word-audio'
    javascript = root / 'app/word-audio.js'
    if args.candidate_dir:
        output = args.candidate_dir.resolve()
        if root / 'speech-training/runs' not in output.parents:
            parser.error('Candidate directory must be under speech-training/runs')
        javascript = output / 'word-audio.js'
    if not 0 <= args.temperature <= 2 or not 0 <= args.seed <= 2**31:
        parser.error('Use temperature 0..2 and a nonnegative 31-bit seed')
    if args.verify:
        summary = verify_public(output)
    else:
        words = [normalize_word(word) for word in args.words] if args.words else collect_words(root)
        if not words or None in words:
            parser.error('Use complete English words or contractions')
        summary = generate(root, list(dict.fromkeys(words)), output, javascript,
            temperature=args.temperature, conditioning=args.conditioning, base_seed=args.seed)
    print(json.dumps(summary, sort_keys=True))


if __name__ == '__main__':
    main()
