"""Signal-truth and boundary tests; fixtures are generated, never learner audio."""
import base64
from copy import deepcopy
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
from scipy.signal import lfilter
import soundfile as sf

import acoustic_measure as a

ROOT = Path(__file__).resolve().parents[1]
PRAAT = ROOT / '.build/acoustic-tools/Praat.app/Contents/MacOS/Praat'


def wave_bytes(values, rate=48000, subtype='PCM_16'):
    buffer = io.BytesIO(); sf.write(buffer, values, rate, format='WAV', subtype=subtype)
    return buffer.getvalue()


def request(values=None, start=.1, end=.9, rate=48000, subtype='PCM_16'):
    if values is None: values = .3 * np.sin(2 * np.pi * 180 * np.arange(rate) / rate)
    return {'audio_base64': base64.b64encode(wave_bytes(values, rate, subtype)).decode(),
            'start_seconds': start, 'end_seconds': end, 'settings': {}, 'vowel_confirmed': False}


class ValidationTests(unittest.TestCase):
    def assert_error(self, code, payload):
        with self.assertRaises(a.AcousticError) as caught: a.validate_request(payload)
        self.assertEqual(caught.exception.code, code)

    def test_pcm16_original_rate_samples_and_stereo_average(self):
        stereo = np.column_stack((np.full(24000, .5), np.full(24000, -.25)))
        audio, info, selection, settings = a.validate_request(request(stereo, .10001, .40001, 48000))
        self.assertEqual(info['sample_rate_hz'], 48000); self.assertEqual(info['channels'], 2)
        np.testing.assert_allclose(audio, .125)
        self.assertEqual(info['channel_handling'], 'arithmetic_mean')
        self.assertEqual(selection['start_sample'], 4800); self.assertEqual(selection['end_sample'], 19200)
        self.assertAlmostEqual(selection['duration_ms'], 300)
        self.assertFalse(selection['vowel_confirmed']); self.assertEqual(settings['pitch_floor_hz'], 50)

    def test_float32_retains_finite_amplitude_and_flags_full_scale_evidence(self):
        values = np.zeros(16000); values[100] = 1.2
        audio, info, _, _ = a.validate_request(request(values, rate=16000, subtype='FLOAT'))
        self.assertAlmostEqual(audio[100], 1.2, places=6)
        self.assertEqual(info['input_full_scale_samples'], 1)
        self.assertAlmostEqual(info['input_full_scale_fraction'], 1 / 16000, places=8)

    def test_pcm_rail_count_does_not_count_negative_one_step_below_rail(self):
        values = np.zeros(16000); values[:3] = [-1, -32767 / 32768, 32767 / 32768]
        _, info, _, _ = a.validate_request(request(values, rate=16000))
        self.assertEqual(info['input_full_scale_samples'], 2)

    def test_invalid_wav_and_nonfinite_samples(self):
        bad = [b'not a wave', wave_bytes(np.zeros(4800), 48000), wave_bytes(np.zeros(8000), 8000),
               wave_bytes(np.zeros(16000), 16000, 'PCM_24'), wave_bytes(np.full(16000, np.nan), 16000, 'FLOAT'),
               wave_bytes(np.full(16000, np.inf), 16000, 'FLOAT')]
        valid = wave_bytes(np.zeros(16000), 16000)
        bad.extend([valid[:-1], valid + b'garbage'])
        for raw in bad:
            with self.subTest(size=len(raw)):
                p = request(); p['audio_base64'] = base64.b64encode(raw).decode()
                self.assert_error('invalid_audio', p)

    def test_complete_extensible_pcm16_is_supported(self):
        raw = wave_bytes(np.zeros((16000, 2)), 16000)
        extra = struct.pack('<HHI', 22, 16, 3) + bytes.fromhex('0100000000001000800000aa00389b71')
        fmt = bytearray(raw[20:36]); struct.pack_into('<H', fmt, 0, 65534)
        extended = raw[:12] + b'fmt ' + struct.pack('<I', 40) + fmt + extra + raw[36:]
        extended = extended[:4] + struct.pack('<I', len(extended) - 8) + extended[8:]
        p = request(); p['audio_base64'] = base64.b64encode(extended).decode()
        self.assertEqual(a.validate_request(p)[1]['channels'], 2)

    def test_invalid_bounds_settings_and_booleans(self):
        for start, end in [(-.1, .9), (.9, .1), (.1, 1.1), (.5, .5), (True, .8), (float('nan'), .8)]:
            with self.subTest(start=start, end=end):
                p = request(); p.update(start_seconds=start, end_seconds=end)
                self.assert_error('invalid_selection', p)
        for settings in [{'pitch_floor_hz': 10}, {'pitch_top_hz': 200, 'pitch_floor_hz': 150},
                         {'formant_ceiling_hz': 9000}, {'pitch_top_hz': float('nan')}, {'extra': 1}, []]:
            with self.subTest(settings=settings):
                p = request(); p['settings'] = settings; self.assert_error('invalid_settings', p)
        p = request(rate=16000); p['settings']['formant_ceiling_hz'] = 8000
        self.assert_error('invalid_settings', p)
        p = request(); p['vowel_confirmed'] = 'true'; self.assert_error('invalid_request', p)

    def test_payload_has_no_target_or_file_paths(self):
        p = request(); p['target'] = 'ship'; self.assert_error('invalid_request', p)
        p = request(); p['audio_base64'] = '/private/file.wav'; self.assert_error('invalid_audio', p)

    def test_invalid_engine_output_is_rejected(self):
        for value in ['bad', 'ACOUSTICS\t1\nP\tNaN\t100', 'ACOUSTICS\t1\nP\t.1\tInfinity',
                      'ACOUSTICS\t1\nP\t.1\t100\nP\t.1\t100']:
            with self.subTest(value=value), self.assertRaises(a.AcousticError): a.parse_engine(value, 1)

    def test_tempfile_cleanup_and_permissions_on_engine_error(self):
        observed = []
        def failing(arguments, timeout):
            filename = Path(arguments[5]); observed.append(filename)
            self.assertEqual(filename.stat().st_mode & 0o777, 0o600)
            self.assertEqual(filename.parent.stat().st_mode & 0o777, 0o700)
            raise a.AcousticError('analysis_timeout')
        with patch.object(a, 'engine_version', return_value='7.0.02'), patch.object(a, 'run_process', side_effect=failing):
            with self.assertRaises(a.AcousticError): a.measure(request(), '/trusted/Praat')
        self.assertTrue(observed); self.assertFalse(observed[0].parent.exists())


@unittest.skipUnless(PRAAT.is_file(), 'Install pinned local Praat with setup_praat.py for numerical tests')
class RealPraatTests(unittest.TestCase):
    def measure(self, payload):
        result = a.measure(payload, str(PRAAT))
        self.assertEqual(result['source'], 'local_praat'); self.assertIsNone(result['pronunciation_grade'])
        self.assertEqual(result['engine']['settings']['pitch_method'], 'filtered_autocorrelation')
        json.dumps(result, allow_nan=False)
        return result

    def test_known_pitch_at_several_frequencies_and_rates(self):
        for frequency, rate in [(100, 16000), (180, 48000), (320, 96000)]:
            with self.subTest(frequency=frequency, rate=rate):
                values = .3 * np.sin(2 * np.pi * frequency * np.arange(rate) / rate)
                result = self.measure(request(values, rate=rate))
                self.assertEqual(result['input']['sample_rate_hz'], rate)
                self.assertAlmostEqual(result['f0']['median_hz'], frequency, delta=1)
                self.assertEqual(result['f0']['status'], 'ok')

    def test_known_resonances_from_five_filter_synthetic_vowel(self):
        rate = 48000; values = np.zeros(rate); values[::480] = 1
        for frequency, bandwidth in [(500, 60), (1500, 90), (2500, 130), (3500, 180), (4500, 240)]:
            radius = np.exp(-np.pi * bandwidth / rate)
            values = lfilter([1], [1, -2 * radius * np.cos(2 * np.pi * frequency / rate), radius * radius], values)
        values *= .6 / np.max(np.abs(values))
        p = request(values, .2, .8, subtype='FLOAT'); p['vowel_confirmed'] = True
        result = self.measure(p)
        self.assertAlmostEqual(result['f0']['median_hz'], 100, delta=1)
        for track, expected in zip(result['formants']['tracks'], [500, 1500, 2500]):
            self.assertAlmostEqual(track['median_hz'], expected, delta=80)
            self.assertGreater(track['valid_frames'], 50)
        self.assertEqual(result['formants']['status'], 'ok')
        self.assertEqual(len(result['formants']['sensitivity']), 3)
        self.assertNotIn('unconfirmed_vowel_boundaries', result['flags'])

    def test_silence_and_noise_do_not_become_successful_vowel_measurements(self):
        for label, values in [('silence', np.zeros(48000)), ('noise', np.random.default_rng(7).normal(0, .1, 48000))]:
            with self.subTest(label=label):
                result = self.measure(request(values))
                self.assertNotEqual(result['f0']['status'], 'ok')
                self.assertLess(result['f0']['coverage'], .2)
                self.assertNotEqual(result['formants']['status'], 'ok')
                if label == 'silence':
                    self.assertIsNone(result['f0']['median_hz'])
                    self.assertTrue(all(frame['value_hz'] is None for frame in result['f0']['frames']))

    def test_short_interval_has_exact_sample_duration_but_no_spectral_summary(self):
        result = self.measure(request(start=.3, end=.32))
        self.assertAlmostEqual(result['selection']['duration_ms'], 20)
        self.assertEqual(result['f0']['status'], 'insufficient_interval')
        self.assertIsNone(result['f0']['median_hz'])
        self.assertEqual(result['formants']['status'], 'insufficient_interval')
        self.assertTrue(all(track['median_hz'] is None for track in result['formants']['tracks']))

    def test_full_curves_preserved_but_summary_uses_selected_interval(self):
        values = .3 * np.sin(2 * np.pi * 180 * np.arange(48000) / 48000); values[24000:] = 0
        result = self.measure(request(values, .65, .9))
        self.assertIsNone(result['f0']['median_hz'])
        self.assertTrue(any(frame['value_hz'] is not None and frame['time_seconds'] < .4 for frame in result['f0']['frames']))
        self.assertTrue(any(frame['value_hz'] is None and frame['time_seconds'] > .65 for frame in result['f0']['frames']))
        self.assertLess(result['f0']['total_frames'], len(result['f0']['frames']))

    def test_full_scale_flag_is_sample_evidence_without_score(self):
        values = .3 * np.sin(2 * np.pi * 180 * np.arange(48000) / 48000); values[9000] = 1
        result = self.measure(request(values))
        self.assertEqual(result['input']['input_full_scale_samples'], 1)
        self.assertIn('full_scale_input_samples', result['flags'])
        self.assertIsNone(result['pronunciation_grade'])


if __name__ == '__main__': unittest.main()
