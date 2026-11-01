"""Bounded local acoustic measurements; deliberately no pronunciation score.

Praat analyses the entire unnormalised mono signal. Measurements are then
restricted to the user-selected sample interval. Reliability flags are
engineering checks, not calibrated probability or phonetic diagnoses.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import json
import math
import os
from pathlib import Path
import re
import signal
import struct
import subprocess
import sys
import tempfile

import numpy as np
import soundfile as sf

MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_REQUEST_BYTES = 14 * 1024 * 1024
MAX_ENGINE_BYTES = 3 * 1024 * 1024
TIME_STEP = .005
ERRORS = {
    'invalid_request': 'Expected one bounded JSON measurement request.',
    'invalid_audio': 'Use a complete finite PCM16 or float32 WAV, mono or stereo, 16–96 kHz, 0.2–15 seconds and at most 10 MiB.',
    'invalid_selection': 'Select a nonempty interval within the recording.',
    'invalid_settings': 'Measurement settings are outside the supported range for this recording.',
    'engine_unavailable': 'The configured local Praat executable is unavailable.',
    'engine_unsupported': 'This measurement requires Praat 6.4 or newer with filtered autocorrelation.',
    'analysis_timeout': 'Local acoustic measurement exceeded its time limit.',
    'analysis_cancelled': 'Local acoustic measurement was cancelled.',
    'analysis_failed': 'The local measurement engine could not produce valid results.',
}


class AcousticError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(ERRORS[code])


def number(value, code):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise AcousticError(code)
    return float(value)


def read_audio(encoded):
    if not isinstance(encoded, str) or len(encoded) > (MAX_AUDIO_BYTES + 2) // 3 * 4:
        raise AcousticError('invalid_audio')
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error):
        raise AcousticError('invalid_audio') from None
    if len(raw) < 44 or len(raw) > MAX_AUDIO_BYTES or raw[:4] != b'RIFF' or raw[8:12] != b'WAVE' or struct.unpack_from('<I', raw, 4)[0] + 8 != len(raw):
        raise AcousticError('invalid_audio')
    chunks = {}; offset = 12
    while offset + 8 <= len(raw):
        tag, size = struct.unpack_from('<4sI', raw, offset); start = offset + 8
        if start + size > len(raw) or tag in chunks and tag in (b'fmt ', b'data'):
            raise AcousticError('invalid_audio')
        if tag in (b'fmt ', b'data'): chunks[tag] = raw[start:start + size]
        offset = start + size + size % 2
    fmt, pcm = chunks.get(b'fmt ', b''), chunks.get(b'data', b'')
    if offset != len(raw) or len(fmt) < 16 or not pcm:
        raise AcousticError('invalid_audio')
    code, channels, rate, byte_rate, block, bits = struct.unpack_from('<HHIIHH', fmt)
    if code == 65534 and len(fmt) >= 40 and struct.unpack_from('<H', fmt, 16)[0] >= 22:
        valid_bits = struct.unpack_from('<H', fmt, 18)[0]
        if valid_bits != bits or fmt[28:40] != bytes.fromhex('00001000800000aa00389b71'):
            raise AcousticError('invalid_audio')
        code = struct.unpack_from('<I', fmt, 24)[0]
    if (code, bits) not in ((1, 16), (3, 32)) or channels not in (1, 2) or not 16000 <= rate <= 96000:
        raise AcousticError('invalid_audio')
    if block != channels * (bits // 8) or byte_rate != rate * block or len(pcm) % block:
        raise AcousticError('invalid_audio')
    frames = len(pcm) // block; duration = frames / rate
    if not .2 <= duration <= 15:
        raise AcousticError('invalid_audio')
    values = np.frombuffer(pcm, dtype='<i2' if code == 1 else '<f4').astype(np.float64).reshape(frames, channels)
    if code == 1: values /= 32768.0
    if not np.isfinite(values).all() or np.max(np.abs(values)) > 16:
        raise AcousticError('invalid_audio')
    mono = values.mean(axis=1)
    info = {'sample_rate_hz': rate, 'channels': channels, 'frames': frames, 'duration_seconds': duration,
            'encoding': 'PCM16' if code == 1 else 'FLOAT32', 'bytes': len(raw),
            'channel_handling': 'arithmetic_mean' if channels == 2 else 'mono'}
    rail = 32767 / 32768 if code == 1 else 1.0
    rails = ((values <= -1.0) | (values >= rail)) if code == 1 else np.abs(values) >= rail
    info['input_full_scale_samples'] = int(np.count_nonzero(rails))
    info['input_full_scale_fraction'] = round(float(np.mean(rails)), 8)
    return mono, info


def validate_request(payload):
    if not isinstance(payload, dict) or set(payload) - {'audio_base64', 'start_seconds', 'end_seconds', 'settings', 'vowel_confirmed'}:
        raise AcousticError('invalid_request')
    audio, info = read_audio(payload.get('audio_base64'))
    start = number(payload.get('start_seconds'), 'invalid_selection'); end = number(payload.get('end_seconds'), 'invalid_selection')
    if not 0 <= start < end <= info['duration_seconds']:
        raise AcousticError('invalid_selection')
    rate = info['sample_rate_hz']; first = int(math.floor(start * rate + .5)); last = int(math.floor(end * rate + .5))
    if not 0 <= first < last <= len(audio):
        raise AcousticError('invalid_selection')
    supplied = payload.get('settings', {})
    if not isinstance(supplied, dict) or set(supplied) - {'pitch_floor_hz', 'pitch_top_hz', 'formant_ceiling_hz'}:
        raise AcousticError('invalid_settings')
    settings = {key: number(supplied.get(key, default), 'invalid_settings') for key, default in (
        ('pitch_floor_hz', 50), ('pitch_top_hz', 800), ('formant_ceiling_hz', 5500))}
    floor, top, ceiling = settings.values()
    if not (40 <= floor <= 300 and 150 <= top <= 1500 and top >= 2 * floor and 3500 <= ceiling <= 8000 and 1.1 * ceiling < rate / 2):
        raise AcousticError('invalid_settings')
    confirmed = payload.get('vowel_confirmed', False)
    if not isinstance(confirmed, bool): raise AcousticError('invalid_request')
    selection = {'start_sample': first, 'end_sample': last, 'start_seconds': first / rate, 'end_seconds': last / rate,
                 'duration_ms': 1000 * (last - first) / rate, 'boundary_source': 'user_selected', 'vowel_confirmed': confirmed}
    return audio, info, selection, settings


def run_process(arguments, timeout):
    process = None
    try:
        process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   env={'PATH': '/usr/bin:/bin', 'LANG': 'C', 'LC_ALL': 'C'})
        output, error = process.communicate(timeout=timeout)
        if process.returncode or len(output) > MAX_ENGINE_BYTES or len(error) > 65536:
            raise AcousticError('analysis_failed')
        return output.decode('utf-8', errors='strict')
    except subprocess.TimeoutExpired:
        raise AcousticError('analysis_timeout') from None
    except (OSError, UnicodeError):
        raise AcousticError('analysis_failed') from None
    finally:
        if process and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=.2)
            except subprocess.TimeoutExpired: process.kill(); process.wait()


def engine_version(praat):
    binary = Path(praat)
    if not binary.is_absolute() or not binary.is_file() or not os.access(binary, os.X_OK):
        raise AcousticError('engine_unavailable')
    version = run_process([str(binary), '--no-pref-files', '--no-plugins', '--version'], 3).strip()
    match = re.match(r'^Praat (\d+)\.(\d+)(?:\.(\d+))?', version)
    if not match or tuple(map(int, match.groups(default='0'))) < (6, 4, 0):
        raise AcousticError('engine_unsupported')
    return '.'.join(match.groups(default='0'))


def finite_or_none(text):
    if text == '--undefined--': return None
    value = float(text)
    if not math.isfinite(value): raise AcousticError('analysis_failed')
    return value


def parse_engine(output, duration):
    lines = output.strip().splitlines()
    if not lines or lines[0] != 'ACOUSTICS\t1': raise AcousticError('analysis_failed')
    pitches = []; variants = {1: [], 2: [], 3: []}
    try:
        for line in lines[1:]:
            parts = line.split('\t')
            if parts[0] == 'P' and len(parts) == 3:
                time = float(parts[1]); value = finite_or_none(parts[2]); target = pitches
                row = (time, value)
            elif parts[0] == 'F' and len(parts) == 9 and parts[1] in ('1', '2', '3'):
                time = float(parts[2]); target = variants[int(parts[1])]
                row = (time, *[finite_or_none(value) for value in parts[3:]])
            else: raise AcousticError('analysis_failed')
            if not math.isfinite(time) or not 0 <= time <= duration or target and time <= target[-1][0] or len(target) >= 3000:
                raise AcousticError('analysis_failed')
            target.append(row)
    except (ValueError, OverflowError):
        raise AcousticError('analysis_failed') from None
    if not pitches or any(not rows for rows in variants.values()): raise AcousticError('analysis_failed')
    return pitches, variants


def quantiles(values):
    if not values: return {'median_hz': None, 'q25_hz': None, 'q75_hz': None}
    q25, median, q75 = np.quantile(values, [.25, .5, .75])
    return {'median_hz': round(float(median), 2), 'q25_hz': round(float(q25), 2), 'q75_hz': round(float(q75), 2)}


def signal_metrics(values):
    rms = math.sqrt(float(np.mean(values * values))); peak = float(np.max(np.abs(values)))
    return {'rms_dbfs': round(20 * math.log10(max(rms, 1e-12)), 2), 'peak': round(peak, 7),
            'dc_offset': round(float(np.mean(values)), 7), 'samples': len(values)}


def summarize(audio, info, selection, settings, version, pitches, variants):
    start, end = selection['start_seconds'], selection['end_seconds']; span = end - start
    chosen = audio[selection['start_sample']:selection['end_sample']]
    metrics = signal_metrics(chosen); full_metrics = signal_metrics(audio)
    flags = []
    if not selection['vowel_confirmed']: flags.append('unconfirmed_vowel_boundaries')
    if info['channels'] == 2: flags.append('stereo_averaged')
    if info['input_full_scale_samples']: flags.append('full_scale_input_samples')
    if abs(metrics['dc_offset']) > .05: flags.append('dc_offset')
    low_signal = metrics['rms_dbfs'] < -60 or metrics['peak'] < 1e-4
    if low_signal: flags.append('low_signal')
    pitch_window = 3 / settings['pitch_floor_hz']; formant_window = .05
    whole_low_signal = full_metrics['rms_dbfs'] < -60 or full_metrics['peak'] < 1e-4
    pitch_short = span < pitch_window
    if pitch_short: flags.append('pitch_interval_too_short')
    f0_frames = [{'time_seconds': round(t, 6), 'value_hz': round(f, 2) if f and f > 0 and not whole_low_signal else None} for t, f in pitches]
    selected_frames = [frame for frame in f0_frames if start <= frame['time_seconds'] < end]
    voiced = [frame['value_hz'] for frame in selected_frames if frame['value_hz'] is not None and not low_signal]
    coverage = len(voiced) / len(selected_frames) if selected_frames else 0
    pitch_status, pitch_reason = ('insufficient_interval', 'shorter_than_pitch_window') if pitch_short else ('unavailable', 'low_signal') if low_signal else ('unavailable', 'no_voiced_frames') if not voiced else ('unreliable', 'low_voiced_coverage') if coverage < .5 or len(voiced) < 3 else ('ok', None)
    if not pitch_short and not low_signal and coverage < .5: flags.append('low_voiced_coverage')
    adjacent = [(a, b) for a, b in zip(selected_frames, selected_frames[1:]) if a['value_hz'] and b['value_hz']]
    if any(abs(math.log2(b['value_hz'] / a['value_hz'])) > .5 for a, b in adjacent):
        flags.append('pitch_discontinuity')
        if pitch_status == 'ok': pitch_status, pitch_reason = 'unreliable', 'pitch_discontinuity'
    pitch_summary = quantiles(voiced if not pitch_short and not low_signal else [])
    f0 = {'status': pitch_status, 'reason': pitch_reason, **pitch_summary, 'voiced_frames': len(voiced),
          'total_frames': len(selected_frames), 'coverage': round(coverage, 4), 'frames': f0_frames}

    pitch_times = np.array([row[0] for row in pitches]); pitch_values = [row[1] for row in pitches]
    def voiced_at(time):
        at = int(np.searchsorted(pitch_times, time))
        nearby = [index for index in (at - 1, at) if 0 <= index < len(pitches)]
        if not nearby: return False
        index = min(nearby, key=lambda index: abs(pitch_times[index] - time))
        return abs(pitch_times[index] - time) <= TIME_STEP * .6 and bool(pitch_values[index] and pitch_values[index] > 0)

    tracks_by_variant = {}; frame_sets = {}; invalid = 0; eligible = 0
    for variant, rows in variants.items():
        ceiling = settings['formant_ceiling_hz'] * (0.8 + .1 * variant)
        values = [[], [], []]; frames = []
        for time, *raw in rows:
            frequencies, bandwidths = raw[:3], raw[3:]
            # Do not summarize a window extending outside the reviewed interval.
            inside = time - formant_window / 2 >= start and time + formant_window / 2 <= end
            # Keep a valid lower-formant prefix. Once an index is ambiguous,
            # do not relabel later resonances to fill its place.
            plausible = []; previous = 90.0; prefix_valid = True
            for frequency, bandwidth in zip(frequencies, bandwidths):
                prefix_valid = bool(prefix_valid and frequency is not None and bandwidth is not None
                                    and previous <= frequency < ceiling - 50
                                    and 20 <= bandwidth <= min(1000, frequency))
                plausible.append(prefix_valid)
                if frequency is not None: previous = frequency + 1e-6
            voiced_frame = not whole_low_signal and voiced_at(time)
            if variant == 2 and inside and voiced_at(time):
                eligible += 1
                if not all(plausible): invalid += 1
            row = {'time_seconds': round(time, 6)}
            for index, frequency in enumerate(frequencies):
                value = round(frequency, 2) if voiced_frame and plausible[index] else None
                row[f'f{index + 1}_hz'] = value
                if value is not None and inside and not low_signal: values[index].append(value)
            frames.append(row)
        frame_sets[variant] = frames; tracks_by_variant[variant] = values
    short = span < formant_window
    if short: flags.append('formant_interval_too_short')
    if invalid: flags.append('invalid_formant_frames')
    main = tracks_by_variant[2]; valid = min(map(len, main)); total = sum(start <= frame['time_seconds'] < end for frame in frame_sets[2])
    sensitivity = [{'ceiling_hz': round(settings['formant_ceiling_hz'] * (0.8 + .1 * variant), 2),
                    'medians_hz': [quantiles(values)['median_hz'] for values in tracks_by_variant[variant]]} for variant in (1, 2, 3)]
    incomplete = any(len(values) < 3 for variant_values in tracks_by_variant.values() for values in variant_values)
    if incomplete and not short and not low_signal: flags.append('formant_sensitivity_incomplete')
    valid_coverage = valid / eligible if eligible else 0
    if eligible and valid_coverage < .7: flags.append('low_formant_coverage')
    unstable = False
    for index in range(3):
        medians = [item['medians_hz'][index] for item in sensitivity]
        if any(value is None for value in medians): continue
        if (max(medians) - min(medians)) / max(medians[1], 1) > .15: unstable = True
    if unstable: flags.append('formant_ceiling_sensitive')
    any_valid = any(main)
    partial = any_valid and not all(main)
    if partial: flags.append('partial_formant_tracks')
    formant_status, formant_reason = ('insufficient_interval', 'shorter_than_formant_window') if short else ('unavailable', 'low_signal') if low_signal else ('unavailable', 'no_valid_voiced_formant_frames') if not any_valid else ('unreliable', 'partial_formant_tracks') if partial else ('unreliable', 'few_valid_frames') if valid < 3 else ('unreliable', 'low_formant_coverage') if valid_coverage < .7 else ('unreliable', 'formant_ceiling_sensitive') if unstable else ('unreliable', 'formant_sensitivity_incomplete') if incomplete else ('ok', None)
    if 0 < valid < 3: flags.append('few_formant_frames')
    formants = {'status': formant_status, 'reason': formant_reason, 'eligible_voiced_frames': eligible, 'valid_frames': valid, 'coverage': round(valid_coverage, 4),
                'tracks': [{'index': index + 1, **quantiles(values if not short else []), 'valid_frames': len(values)} for index, values in enumerate(main)],
                'frames': frame_sets[2], 'sensitivity': sensitivity}
    return {'schema_version': 1, 'measurement_type': 'acoustic_signal', 'source': 'local_praat', 'pronunciation_grade': None,
            'input': info, 'selection': selection,
            'engine': {'name': 'Praat', 'version': version, 'settings': {**settings,
                'pitch_method': 'filtered_autocorrelation', 'time_step_seconds': TIME_STEP,
                'pitch_maximum_candidates': 15, 'pitch_very_accurate': False, 'pitch_attenuation_at_top': .03,
                'pitch_silence_threshold': .09, 'pitch_voicing_threshold': .50, 'pitch_octave_cost': .055,
                'pitch_octave_jump_cost': .35, 'pitch_voiced_unvoiced_cost': .14,
                'pitch_effective_window_seconds': pitch_window, 'formant_method': 'burg',
                'maximum_formants': 5, 'formant_window_seconds': .025, 'formant_physical_window_seconds': formant_window,
                'pre_emphasis_from_hz': 50, 'sensitivity_ceiling_factors': [.9, 1.0, 1.1],
                'quality_checks': {'low_signal_rms_dbfs': -60, 'low_signal_peak': .0001,
                    'minimum_voiced_coverage': .5, 'minimum_formant_coverage': .7, 'minimum_summary_frames': 3,
                    'formant_sensitivity_relative_range': .15, 'pitch_adjacent_jump_octaves': .5,
                    'formant_minimum_f1_hz': 90, 'bandwidth_minimum_hz': 20, 'bandwidth_maximum_hz': 1000,
                    'bandwidth_must_not_exceed_formant': True, 'formant_ceiling_margin_hz': 50}},
                'analysis_context': 'full_original_sound', 'normalization': 'none'},
            'signal': {'selected': metrics, 'whole_clip': full_metrics}, 'f0': f0, 'formants': formants,
            'flags': list(dict.fromkeys(flags)), 'limitations': [
                'Acoustic measurements are not a pronunciation score or an accent diagnosis.',
                'Duration is the selected sample interval; a vowel label is a user confirmation, not automatic segmentation.',
                'Quality flags and parameter sensitivity are engineering checks, not calibrated confidence intervals.',
                'F0 and formants can contain tracking errors; compare curves with the waveform/spectrogram.',
                'Formant frequencies depend on anatomy, vowel and context; distance from one reference speaker is not correctness.',
                'A 5 ms analysis step does not imply independent 5 ms temporal resolution.',
            ]}


def measure(payload, praat, timeout=20):
    audio, info, selection, settings = validate_request(payload)
    version = engine_version(praat)
    with tempfile.TemporaryDirectory(prefix='egl-acoustics-') as directory:
        os.chmod(directory, 0o700)
        filename = Path(directory) / 'input.wav'
        descriptor = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(descriptor)
        sf.write(filename, audio, info['sample_rate_hz'], format='WAV', subtype='FLOAT')
        output = run_process([str(Path(praat)), '--no-pref-files', '--no-plugins', '--run',
                              str(Path(__file__).with_suffix('.praat')), str(filename),
                              str(settings['pitch_floor_hz']), str(settings['pitch_top_hz']), str(settings['formant_ceiling_hz'])], timeout)
        pitches, variants = parse_engine(output, info['duration_seconds'])
        return summarize(audio, info, selection, settings, version, pitches, variants)


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--praat', required=True)
    args = parser.parse_args()
    def cancel(_signum, _frame): raise AcousticError('analysis_cancelled')
    signal.signal(signal.SIGTERM, cancel); signal.signal(signal.SIGINT, cancel)
    try:
        raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(raw) > MAX_REQUEST_BYTES: raise AcousticError('invalid_request')
        try:
            payload = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite')))
        except (ValueError, UnicodeError): raise AcousticError('invalid_request') from None
        result = measure(payload, args.praat)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(',', ':')))
        return 0
    except AcousticError as error:
        print(json.dumps({'error': {'code': error.code, 'message': ERRORS[error.code]}})); return 2
    except Exception:
        print(json.dumps({'error': {'code': 'analysis_failed', 'message': ERRORS['analysis_failed']}})); return 2


if __name__ == '__main__':
    sys.exit(main())
