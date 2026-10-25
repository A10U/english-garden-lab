"""Local English text references and independent acoustic phone comparison.

Acoustic checkpoint: Meta wav2vec2-lv-60-espeak-cv-ft, Apache-2.0.
https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft
https://huggingface.co/docs/transformers/model_doc/wav2vec2_phoneme
Text references: phonemizer/eSpeak NG (GPL-3.0), separately installed tools.
https://bootphon.github.io/phonemizer/api_reference.html

No model downloads occur here. The audio model is loaded only on the first
audio request, from a local directory. Text IPA is never presented as an
observation of audio. Phone edits are comparisons, not pronunciation grades.
"""

from __future__ import annotations

import itertools
import math
import os
from pathlib import Path
import re
import sys
import threading
import unicodedata
from typing import Any

import numpy as np


SAMPLE_RATE = 16000
WORD_PATTERN = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)*|\d+(?:[.,]\d+)*")
ACCENTS = {"en-us", "en-gb"}
_PHONEMIZER_LOCK = threading.RLock()
LIMITATIONS = [
    "เสียงที่แสดงเป็นหน่วยเสียงที่โมเดลคาดจากไฟล์เสียง อาจตรวจผิดหรือข้ามเสียงได้",
    "เวลาแต่ละหน่วยเสียงประมาณจากเฟรม CTC ไม่ใช่ขอบเขตเสียงที่ผู้เชี่ยวชาญกำกับ",
    "IPA จากข้อความเป็นเสียงอ้างอิงตามกฎ ไม่ครอบคลุมทุกสำเนียง การลดรูป หรือชื่อเฉพาะ",
    "ความต่างระหว่างหน่วยเสียงไม่ใช่คะแนนการออกเสียง และไม่ได้ตัดสินว่าเป็นสำเนียงเจ้าของภาษา",
    "ช่วงที่มีเสียงคำนวณจากพลังงานอย่างง่าย จึงอาจรวมเสียงรบกวนด้วย",
]


class AnalysisError(ValueError):
    """A validation/dependency error suitable for a local API response."""


def canonical_phone(phone: str) -> str:
    """Ignore stress/tie glyph conventions, preserving phonetic distinctions.

    In particular, r/ɹ, vowel length and vowel quality remain distinct. Mapping
    every rhotic or reduced vowel together would conceal observable differences.
    ASCII g and IPA script-g are the same transcription convention here.
    """
    return unicodedata.normalize("NFC", phone).translate(
        str.maketrans({"ˈ": "", "ˌ": "", "\u0361": "", "\u035c": "", "g": "ɡ"})
    )


def decode_ctc_segments(
    token_ids: list[int],
    id_to_token: dict[int, str],
    *,
    blank_id: int,
    duration_seconds: float,
    frame_seconds: float,
) -> list[dict]:
    """Collapse CTC runs, retaining duplicates separated by a blank.

    Start/end are approximate frame intervals. A multi-character inventory unit
    such as tʃ or ɑːɹ stays intact rather than being split into Unicode letters.
    """
    if duration_seconds <= 0 or frame_seconds <= 0:
        raise ValueError("duration_seconds and frame_seconds must be positive")
    phones = []
    cursor = 0
    for token_id, group in itertools.groupby(token_ids):
        count = sum(1 for _ in group)
        first, cursor = cursor, cursor + count
        token_id = int(token_id)
        phone = id_to_token.get(token_id, "<unk>")
        if token_id == blank_id or not phone.strip() or phone == "|" or (
            phone.startswith("<") and phone.endswith(">")
        ):
            continue
        start = max(0.0, min(first * frame_seconds, duration_seconds))
        end = max(0.0, min(cursor * frame_seconds, duration_seconds))
        if end <= start:
            continue
        phones.append({"phone": phone, "start": round(start, 6), "end": round(end, 6)})
    return phones


def phone_match_summary(operations: list[dict], reference_count: int, *, observed_available: bool) -> dict:
    """Explainable phone agreement, not a calibrated pronunciation grade.

    Each target phone contributes one comparison. Extra observed phones add
    comparisons too, so insertions cannot leave an otherwise perfect 100%.
    No observed speech is unassessed rather than a fabricated zero score.
    """
    counts = {kind: sum(op["type"] == kind for op in operations)
              for kind in ("match", "substitute", "delete", "insert")}
    denominator = reference_count + counts["insert"]
    percent = round(100.0 * counts["match"] / denominator, 1) \
        if reference_count > 0 and denominator > 0 and observed_available else None
    return {
        "match_percent": percent,
        "matched_phones": counts["match"], "reference_phones": reference_count,
        "inserted_phones": counts["insert"], "substituted_phones": counts["substitute"],
        "deleted_phones": counts["delete"], "compared_phones": denominator,
    }


def align_phone_sequences(reference_words: list[dict], observed: list[dict]) -> dict:
    """Levenshtein alignment of intact phone units, with word provenance.

    Inserts between words attach to the following word; trailing inserts attach
    to the final word. Deleted phones have no invented acoustic interval. Their
    start/end are null, and a wholly deleted word may have null start/end too.
    """
    expected, word_indices = [], []
    for word in reference_words:
        for phone in word["phones"]:
            expected.append(phone)
            word_indices.append(word["index"])
    heard = [entry["phone"] for entry in observed]
    a, b = list(map(canonical_phone, expected)), list(map(canonical_phone, heard))
    rows, cols = len(a), len(b)
    costs = [list(range(cols + 1))] + [[i] + [0] * cols for i in range(1, rows + 1)]
    for i in range(1, rows + 1):
        for j in range(1, cols + 1):
            costs[i][j] = min(
                costs[i - 1][j - 1] + (a[i - 1] != b[j - 1]),
                costs[i - 1][j] + 1,
                costs[i][j - 1] + 1,
            )
    operations, i, j = [], rows, cols
    while i or j:
        # Prefer diagonal on ties: it gives a stable minimal-pair explanation.
        if i and j and costs[i][j] == costs[i - 1][j - 1] + (a[i - 1] != b[j - 1]):
            i, j = i - 1, j - 1
            operation = {
                "type": "match" if a[i] == b[j] else "substitute",
                "expected": expected[i], "observed": heard[j],
                "expected_index": i, "observed_index": j,
                "word_index": word_indices[i],
                "start": observed[j]["start"], "end": observed[j]["end"],
            }
        elif i and costs[i][j] == costs[i - 1][j] + 1:
            i -= 1
            operation = {
                "type": "delete", "expected": expected[i], "observed": None,
                "expected_index": i, "observed_index": None,
                "word_index": word_indices[i], "start": None, "end": None,
            }
        else:
            j -= 1
            word_index = word_indices[min(i, rows - 1)] if rows else None
            operation = {
                "type": "insert", "expected": None, "observed": heard[j],
                "expected_index": None, "observed_index": j,
                "word_index": word_index,
                "start": observed[j]["start"], "end": observed[j]["end"],
            }
        operations.append(operation)
    operations.reverse()
    words = []
    for word in reference_words:
        relevant = [op for op in operations if op["word_index"] == word["index"]]
        times = [op for op in relevant if op["start"] is not None]
        differences = [
            {key: op[key] for key in ("type", "expected", "observed", "start", "end")}
            for op in relevant if op["type"] != "match"
        ]
        if not word["phones"] or not observed:
            status = "unresolved"
        else:
            status = "difference" if differences else "matched"
        words.append({
            "index": word["index"], "text": word["text"], "ipa": word["ipa"],
            "status": status,
            "start": min(op["start"] for op in times) if times else None,
            "end": max(op["end"] for op in times) if times else None,
            "differences": differences,
            **phone_match_summary(relevant, len(word["phones"]), observed_available=bool(observed)),
        })
    summary = phone_match_summary(operations, rows, observed_available=bool(observed))
    summary.update({
        "formula": "100 * matched_phones / (reference_phones + inserted_phones)",
        "description": "เปอร์เซ็นต์หน่วยเสียงที่จับคู่กับอ้างอิงได้ รวมเสียงที่เพิ่มเข้ามาในการนับ ไม่ใช่คะแนนความสามารถหรือความมั่นใจของโมเดล",
        "metric": "phone_agreement", "calibrated_pronunciation_grade": False,
    })
    return {"words": words, "operations": operations, "summary": summary}


def waveform_metrics(waveform: Any) -> tuple[np.ndarray, dict]:
    """Validate finite mono 16kHz samples and measure simple energy metrics."""
    try:
        audio = np.asarray(waveform, dtype=np.float32)
    except (TypeError, ValueError) as exc:
        raise AnalysisError("อ่านข้อมูลเสียงไม่ได้ กรุณาใช้ไฟล์เสียงที่ถูกต้อง") from exc
    if audio.ndim != 1 or not np.isfinite(audio).all():
        raise AnalysisError("เสียงต้องเป็นโมโนและไม่มีค่าตัวอย่างเสียงที่เสียหาย")
    duration = audio.size / SAMPLE_RATE
    if not 0.3 <= duration <= 15:
        raise AnalysisError("กรุณาใช้เสียงยาวระหว่าง 0.3 ถึง 15 วินาที")
    rms = float(np.sqrt(np.mean(audio.astype(np.float64) ** 2)))
    rms_dbfs = 20 * math.log10(max(rms, 1e-12))
    if rms_dbfs < -55 or float(np.max(np.abs(audio))) < 1e-4:
        raise AnalysisError("เสียงเงียบหรือเบาเกินไป กรุณาพูดให้ชัดและลองใหม่")
    # Non-overlapping 20 ms windows, counted by actual samples including the tail.
    threshold = 10 ** (max(-45.0, rms_dbfs - 16.0) / 20)
    active_samples = 0
    for start in range(0, audio.size, 320):
        frame = audio[start:start + 320].astype(np.float64)
        if float(np.sqrt(np.mean(frame ** 2))) >= threshold:
            active_samples += frame.size
    if active_samples / SAMPLE_RATE < 0.12:
        raise AnalysisError("ช่วงเสียงพูดสั้นหรือเบาเกินไป กรุณาบันทึกใหม่")
    return audio, {
        "duration_seconds": round(duration, 6), "rms_dbfs": round(rms_dbfs, 3),
        "voiced_seconds": round(active_samples / SAMPLE_RATE, 6),
    }


class PhoneticAnalyzer:
    """Thread-safe local analyzer; model and Torch imports are lazy."""

    def __init__(self, model_dir: str | Path | None = None, device: str = "cpu"):
        self.model_dir = Path(model_dir or Path(__file__).parent / "models/phoneme-ctc").resolve()
        if device not in ("cpu", "mps"):
            raise ValueError("device must be cpu or mps")
        self.device = device
        self._model_lock = threading.RLock()
        self._inference_lock = threading.Lock()
        self._model = self._extractor = self._tokenizer = None

    @staticmethod
    def _phonemize_words(
        words: list[str], accent: str, *, sentence: str,
    ) -> tuple[list[list[str]], list[str], str]:
        with _PHONEMIZER_LOCK:
            try:
                from phonemizer import phonemize
                from phonemizer.separator import Separator
                if sys.platform == "darwin" and not os.environ.get("PHONEMIZER_ESPEAK_LIBRARY"):
                    from phonemizer.backend.espeak.wrapper import EspeakWrapper
                    for candidate in (
                        "/opt/homebrew/opt/espeak-ng/lib/libespeak-ng.dylib",
                        "/opt/homebrew/lib/libespeak-ng.dylib",
                        "/usr/local/lib/libespeak-ng.dylib",
                    ):
                        if Path(candidate).is_file():
                            EspeakWrapper.set_library(candidate)
                            break
                kwargs = dict(
                    language=accent, backend="espeak", strip=True,
                    separator=Separator(phone=" ", word=" | "),
                    preserve_punctuation=False, language_switch="remove-flags", njobs=1,
                )
                # Preserve sentence-context weak forms, e.g. the article "a".
                # eSpeak can join/drop words, so retain this mapping only when
                # both phonemizations have exactly one chunk per source word.
                normalized_sentence = sentence.replace("’", "'")
                plain_sentence = phonemize([normalized_sentence], with_stress=False, **kwargs)[0]
                stressed_sentence = phonemize([normalized_sentence], with_stress=True, **kwargs)[0]
                plain = [chunk.strip() for chunk in plain_sentence.split("|") if chunk.strip()]
                stressed = [chunk.strip() for chunk in stressed_sentence.split("|") if chunk.strip()]
                context = "sentence"
                if len(plain) != len(words) or len(stressed) != len(words):
                    normalized = [word.replace("’", "'") for word in words]
                    plain = phonemize(normalized, with_stress=False, **kwargs)
                    stressed = phonemize(normalized, with_stress=True, **kwargs)
                    context = "isolated_words"
            except (ImportError, OSError, RuntimeError) as exc:
                raise AnalysisError("ยังเปิดตัวแปลง IPA ไม่ได้ กรุณาตรวจการติดตั้ง phonemizer และ eSpeak NG") from exc
        phones = [[phone for phone in value.replace("|", " ").split() if phone] for value in plain]
        ipa = [value.replace("|", " ").replace(" ", "").strip() for value in stressed]
        if len(phones) != len(words) or len(ipa) != len(words):
            raise AnalysisError("แปลงคำเป็น IPA ไม่ครบ กรุณาลองข้อความสั้นลง")
        return phones, ipa, context

    def annotate_text(self, text: str, accent: str = "en-us") -> dict:
        if not isinstance(text, str) or not text.strip():
            raise AnalysisError("กรุณาใส่ข้อความภาษาอังกฤษ")
        text = text.strip()
        if len(text) > 1000:
            raise AnalysisError("กรุณาใช้ข้อความไม่เกิน 1,000 ตัวอักษร")
        if accent not in ACCENTS:
            raise AnalysisError("เลือกเสียงอ้างอิง en-us หรือ en-gb")
        tokens = WORD_PATTERN.findall(text)
        if not tokens:
            raise AnalysisError("ไม่พบคำภาษาอังกฤษในข้อความ")
        if len(tokens) > 180:
            raise AnalysisError("กรุณาใช้ข้อความสั้นลง")
        phones, ipa, context = self._phonemize_words(tokens, accent, sentence=text)
        words = [
            {"index": index, "text": token, "ipa": ipa[index], "phones": phones[index]}
            for index, token in enumerate(tokens)
        ]
        return {
            "text": text, "accent": accent, "ipa": " ".join(ipa), "words": words,
            "analysis_type": "text_pronunciation_reference", "audio_analyzed": False,
            "reference_context": context,
            "notes": [
                "IPA อ้างอิงคำนวณทั้งประโยคเพื่อรักษาเสียงลดรูปตามบริบท เมื่อแบ่งคำได้ตรงกัน"
                if context == "sentence" else
                "ตัวแปลงแบ่งคำในประโยคไม่ตรงกับข้อความ จึงใช้อ้างอิงทีละคำ เสียงลดรูปตามบริบทอาจต่างกัน"
            ],
        }

    def _load_model(self) -> None:
        with self._model_lock:
            if self._model is not None:
                return
            if not self.model_dir.is_dir():
                raise AnalysisError("ยังไม่มีโมเดลวิเคราะห์หน่วยเสียงในเครื่อง")
            try:
                import torch
                from transformers import (
                    Wav2Vec2FeatureExtractor, Wav2Vec2PhonemeCTCTokenizer, Wav2Vec2ForCTC,
                )
                if self.device == "mps" and not torch.backends.mps.is_available():
                    raise AnalysisError("อุปกรณ์ MPS ไม่พร้อมใช้งาน กรุณาใช้ cpu")
                extractor = Wav2Vec2FeatureExtractor.from_pretrained(self.model_dir, local_files_only=True)
                tokenizer = Wav2Vec2PhonemeCTCTokenizer.from_pretrained(
                    self.model_dir, local_files_only=True, do_phonemize=False,
                )
                model = Wav2Vec2ForCTC.from_pretrained(self.model_dir, local_files_only=True)
                model = model.to(device=self.device, dtype=torch.float32).eval()
            except AnalysisError:
                raise
            except (ImportError, OSError, RuntimeError, ValueError) as exc:
                raise AnalysisError("ยังโหลดโมเดลวิเคราะห์เสียงไม่ได้ กรุณาตรวจไฟล์โมเดลในเครื่อง") from exc
            # Publish only after every component successfully initialized.
            self._extractor, self._tokenizer, self._model = extractor, tokenizer, model

    def _recognize(self, audio: np.ndarray) -> list[dict]:
        with self._inference_lock:
            self._load_model()
            import torch
            batch = self._extractor(audio, sampling_rate=SAMPLE_RATE, return_tensors="pt")
            batch = {key: value.to(self.device) for key, value in batch.items()}
            with torch.inference_mode():
                logits = self._model(**batch).logits
                token_ids = logits.argmax(dim=-1)[0].cpu().tolist()
            vocabulary = {value: key for key, value in self._tokenizer.get_vocab().items()}
            ratio = getattr(self._model.config, "inputs_to_logits_ratio", 320)
            return decode_ctc_segments(
                token_ids, vocabulary, blank_id=self._tokenizer.pad_token_id,
                duration_seconds=audio.size / SAMPLE_RATE,
                frame_seconds=float(ratio) / SAMPLE_RATE,
            )

    def analyze_waveform(self, waveform16k: Any, text: str, accent: str = "en-us", *,
                         context_text: str | None = None, context_word_index: int | None = None,
                         context_phone_index: int | None = None) -> dict:
        audio, metrics = waveform_metrics(waveform16k)
        if context_text is not None or context_word_index is not None or context_phone_index is not None:
            if context_text is None or context_word_index is None:
                raise AnalysisError("เลือกคำและประโยคต้นฉบับให้ครบก่อนฝึกคำนี้")
            context = self.annotate_text(context_text, accent)
            if isinstance(context_word_index, bool) or not isinstance(context_word_index, int) or not 0 <= context_word_index < len(context["words"]):
                raise AnalysisError("ไม่พบคำที่เลือกในประโยคต้นฉบับ")
            selected = context["words"][context_word_index]
            normalized = lambda value: value.strip().casefold().replace("’", "'")
            if normalized(selected["text"]) != normalized(text):
                raise AnalysisError("คำที่ฝึกไม่ตรงกับคำที่เลือกในประโยค")
            reference = {
                "text": text, "accent": accent, "ipa": selected["ipa"],
                "words": [{**selected, "index": 0}],
                "analysis_type": "text_pronunciation_reference", "audio_analyzed": False,
                "reference_context": "word_in_sentence",
                "context": {"text": context_text, "word_index": context_word_index},
                "notes": ["ใช้คำอ่านตามตำแหน่งในประโยคเดิม รวมรูปเสียงเบาของคำสั้น ๆ"],
            }
            if context_phone_index is not None:
                if isinstance(context_phone_index, bool) or not isinstance(context_phone_index, int) or not 0 <= context_phone_index < len(selected["phones"]):
                    raise AnalysisError("ไม่พบหน่วยเสียงที่เลือกในคำนี้")
                phone = selected["phones"][context_phone_index]
                reference.update({
                    "ipa": phone,
                    "words": [{"index": 0, "text": selected["text"], "ipa": phone, "phones": [phone]}],
                    "reference_context": "phone_in_word",
                    "context": {"text": context_text, "word_index": context_word_index,
                                "phone_index": context_phone_index},
                    "notes": [
                        "ฝึกหน่วยเสียงที่เลือกแยกจากคำ ไม่ใช่คะแนนการออกเสียงทั้งคำ",
                        "เสียงสั้นอาจตรวจจับยาก ลองยืดเสียงที่ยืดได้หรือออกเสียงซ้ำ ให้คลิปยาวอย่างน้อย 0.3 วินาที",
                        "เสียงที่ออกซ้ำอาจถูกนับเป็นเสียงเพิ่ม ใช้ผลนี้หาจุดฝึก ไม่ใช่เกรด",
                    ],
                })
        else:
            reference = self.annotate_text(text, accent)
        try:
            phones = self._recognize(audio)
        except AnalysisError:
            raise
        except (OSError, RuntimeError, ValueError) as exc:
            raise AnalysisError("วิเคราะห์ไฟล์เสียงไม่สำเร็จ กรุณาลองไฟล์เสียงสั้นลง") from exc
        if not phones:
            raise AnalysisError("โมเดลยังตรวจไม่พบหน่วยเสียง กรุณาพูดให้ชัดและลองใหม่")
        return {
            "reference": reference,
            "observed": {
                "ipa": " ".join(phone["phone"] for phone in phones), "phones": phones,
                "duration_seconds": metrics["duration_seconds"],
            },
            "alignment": align_phone_sequences(reference["words"], phones),
            "metrics": metrics, "analysis_type": "acoustic_phone_comparison",
            "audio_analyzed": True, "limitations": list(LIMITATIONS),
        }
