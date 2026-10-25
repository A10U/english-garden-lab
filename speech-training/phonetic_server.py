"""Loopback-only phonetic analysis service for the local learning app."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import wave

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.middleware.trustedhost import TrustedHostMiddleware

from phonetic_engine import AnalysisError, PhoneticAnalyzer

ROOT = Path(__file__).resolve().parents[1]
TRAINING = ROOT / "speech-training"
MAX_BYTES = 10 * 1024 * 1024
LOCAL_ORIGIN = re.compile(r"https?://(?:127\.0\.0\.1|localhost)(?::\d{1,5})?\Z")
analyzer = PhoneticAnalyzer(TRAINING / "models/phoneme-ctc", device="cpu")
audio_lock = asyncio.Semaphore(1)
decode_lock = asyncio.Semaphore(2)


@asynccontextmanager
async def lifespan(_app):
    # Keep the acoustic model lazy; opening a lesson does not load it or access a mic.
    yield


app = FastAPI(title="English Garden phonetics", lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "testserver"])
app.add_middleware(CORSMiddleware, allow_origins=["null"],
    allow_origin_regex=LOCAL_ORIGIN.pattern, allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"], allow_credentials=False,
    expose_headers=["Content-Length", "X-Audio-Duration", "X-Audio-Rms-Dbfs",
                    "X-Audio-Samples", "X-Audio-Sample-Rate"])


@app.middleware("http")
async def local_requests_only(request, call_next):
    origin = request.headers.get("origin")
    if origin and origin != "null" and not LOCAL_ORIGIN.fullmatch(origin):
        return JSONResponse({"detail": "บริการนี้รับคำขอจากหน้าในเครื่องเท่านั้น"}, status_code=403)
    length = request.headers.get("content-length")
    if length and (not length.isdigit() or int(length) > MAX_BYTES + 1024 * 1024):
        return JSONResponse({"detail": "เลือกไฟล์เสียงขนาดไม่เกิน 10 MB"}, status_code=413)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response


class TextInput(BaseModel):
    text: str = Field(min_length=1, max_length=350)
    accent: str = "en-us"


def validate_text(text, accent):
    text = text.strip()
    if not text or len(text) > 350 or len(text.split()) > 60:
        raise HTTPException(422, "ใช้ประโยคอังกฤษสั้น ๆ ไม่เกิน 350 ตัวอักษรหรือ 60 คำ")
    if accent not in {"en-us", "en-gb"}:
        raise HTTPException(422, "เลือกสำเนียง US หรือ UK")
    return text


@app.get("/api/phonetics/health")
def health():
    source_path = TRAINING / "phonetic-model-source.json"
    return {"status": "ok", "text_engine": "phonemizer/espeak-ng",
        "audio_model_available": (TRAINING / "models/phoneme-ctc/config.json").exists(),
        "ffmpeg_available": shutil.which("ffmpeg") is not None,
        "model_source": json.loads(source_path.read_text()) if source_path.exists() else None,
        "audio_retention": "temporary decoding only; removed after request",
        "pronunciation_grade": False}


@app.post("/api/phonetics/text")
async def text_reference(body: TextInput):
    text = validate_text(body.text, body.accent)
    try:
        return await run_in_threadpool(analyzer.annotate_text, text, body.accent)
    except AnalysisError as exc:
        raise HTTPException(422, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc


def decode_audio(data):
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise AnalysisError("ยังไม่มี FFmpeg สำหรับอ่านไฟล์เสียงในเครื่อง")
    # A temporary seekable input also handles recorder MP4/M4A containers.
    with tempfile.TemporaryDirectory(prefix="egl-phonetics-") as temp:
        source = Path(temp) / "upload.audio"
        source.write_bytes(data)
        command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin",
            "-protocol_whitelist", "file,pipe",
            "-format_whitelist", "wav,mp3,flac,ogg,matroska,mov,aac,aiff,au,caf",
            "-i", str(source), "-vn", "-sn", "-dn", "-ac", "1", "-ar", "16000",
            "-t", "15.1", "-f", "f32le", "pipe:1"]
        try:
            decoded = subprocess.run(command, capture_output=True, timeout=20, check=False)
        except subprocess.TimeoutExpired as exc:
            raise AnalysisError("อ่านไฟล์เสียงไม่สำเร็จ ลองใช้คลิปสั้นลง") from exc
        if decoded.returncode or not decoded.stdout:
            raise AnalysisError("อ่านไฟล์เสียงนี้ไม่ได้ ลองใช้ WAV, MP3, M4A หรือ WebM")
        waveform = np.frombuffer(decoded.stdout, dtype="<f4").copy()
    if len(waveform) > 15 * 16000:
        raise AnalysisError("ใช้เสียงไม่เกิน 15 วินาทีต่อครั้ง")
    return waveform


def normalize_recording(data):
    """Recover playable PCM, deriving duration from samples, never container tags.

    This validates a recording for playback only. Quiet/silent recordings are
    preserved; they do not have to satisfy phonetic-analysis speech thresholds.
    BytesIO is seekable, so wave writes final RIFF/data sizes rather than the
    unknown lengths common in streamed recorder containers or piped WAV output.
    """
    waveform = decode_audio(data)
    if waveform.ndim != 1 or not np.isfinite(waveform).all():
        raise AnalysisError("ไฟล์เสียงมีข้อมูลตัวอย่างเสียงที่เสียหาย")
    duration = len(waveform) / 16000
    if not 0.2 <= duration <= 15:
        raise AnalysisError("ใช้เสียงยาวระหว่าง 0.2 ถึง 15 วินาที")
    rms = float(np.sqrt(np.mean(waveform.astype(np.float64) ** 2)))
    rms_dbfs = 20 * math.log10(max(rms, 1e-12))
    pcm = np.rint(np.clip(waveform, -1.0, 1.0) * 32767).astype("<i2")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(pcm.tobytes())
    return output.getvalue(), {
        "X-Audio-Duration": f"{duration:.6f}",
        "X-Audio-Rms-Dbfs": f"{rms_dbfs:.3f}",
        "X-Audio-Samples": str(len(waveform)),
        "X-Audio-Sample-Rate": "16000",
    }


@app.post("/api/phonetics/normalize")
async def prepare_recording(audio: UploadFile = File(...)):
    """Local-only playback preparation; no text, grading or model is needed."""
    try:
        data = await audio.read(MAX_BYTES + 1)
        if not data:
            raise HTTPException(422, "ยังไม่มีข้อมูลเสียงที่บันทึกได้")
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "เลือกไฟล์เสียงขนาดไม่เกิน 10 MB")
        async with decode_lock:
            wav, headers = await run_in_threadpool(normalize_recording, data)
        return Response(wav, media_type="audio/wav", headers=headers)
    except (AnalysisError, ValueError) as exc:
        raise HTTPException(422, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(503, "FFmpeg สำหรับเตรียมเสียงในเครื่องยังไม่พร้อม") from exc
    finally:
        await audio.close()


@app.post("/api/phonetics/analyze")
async def analyze(audio: UploadFile = File(...), text: str = Form(...), accent: str = Form("en-us"),
                  context_text: str | None = Form(None), context_word_index: int | None = Form(None),
                  context_phone_index: int | None = Form(None)):
    text = validate_text(text, accent)
    if context_text is not None:
        context_text = validate_text(context_text, accent)
    try:
        if context_phone_index is not None and (context_text is None or context_word_index is None):
            raise HTTPException(422, "เลือกคำและประโยคต้นฉบับให้ครบก่อนฝึกหน่วยเสียง")
        data = await audio.read(MAX_BYTES + 1)
        if not data:
            raise HTTPException(422, "ยังไม่มีไฟล์เสียงให้วิเคราะห์")
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "เลือกไฟล์เสียงขนาดไม่เกิน 10 MB")
        async with audio_lock:
            waveform = await run_in_threadpool(decode_audio, data)
            return await run_in_threadpool(analyzer.analyze_waveform, waveform, text, accent,
                context_text=context_text, context_word_index=context_word_index,
                context_phone_index=context_phone_index)
    except AnalysisError as exc:
        raise HTTPException(422, str(exc)) from exc
    except (FileNotFoundError, RuntimeError) as exc:
        raise HTTPException(503, "โมเดลวิเคราะห์เสียงยังไม่พร้อม: " + str(exc)) from exc
    finally:
        await audio.close()


@app.get("/")
def landing():
    return RedirectResponse("/speech-training/listen.html")


@app.get("/favicon.ico")
def favicon():
    return Response(status_code=204)


@app.get("/{asset:path}")
def static_asset(asset: str):
    allowed_app = {"index.html", "app.js", "content.js", "core.js", "storage.js", "garden.js",
        "styles.css", "phonetics.js", "phonetics.css", "phonetic-data.js", "phone-guide.js", "sound-foundations.js", "articulation-images.js",
        "study-help.js", "reference-audio.js", "spelling-guide.js", "word-audio.js", "browser-phonetics.js",
        "browser-phonetics-worker.js", "browser-phoneme-model.js", "phonetic-alignment.js",
        "vendor/onnxruntime/ort.wasm.min.js", "vendor/onnxruntime/ort-wasm-simd-threaded.mjs",
        "vendor/onnxruntime/ort-wasm-simd-threaded.wasm", "vendor/onnxruntime/LICENSE.txt",
        "vendor/onnxruntime/ThirdPartyNotices.txt"}
    allowed = asset.startswith("app/") and asset[4:] in allowed_app
    allowed = allowed or asset in {"index.html", "speech-training/listen.html"}
    allowed = allowed or bool(re.fullmatch(
        r"speech-training/runs/[A-Za-z0-9_-]+/(?:samples/)?tts-\d{3}\.wav", asset))
    allowed_demo = asset in {"speech-training/demo-assets/demo-data.json",
                            "speech-training/demo-assets/demo-data.js"}
    allowed_demo = allowed_demo or bool(re.fullmatch(
        r"speech-training/demo-assets/audio/(?:baseline|candidate|practice)/tts-\d{3}\.wav", asset))
    allowed_word = bool(re.fullmatch(
        r"speech-training/word-audio/(?:[a-z0-9_-]+\.wav|manifest\.json|ATTRIBUTION\.txt|SHA256SUMS)", asset))
    articulation_assets = {"b.svg", "d.svg", "eth.svg", "f.svg", "g.svg", "i.svg", "ih.svg",
        "k.svg", "l.svg", "m.svg", "n.svg", "ng.svg", "p.svg", "s.svg", "sh.svg", "t.svg",
        "theta.svg", "v.svg", "z.svg", "zh.svg", "ATTRIBUTION.json", "ATTRIBUTION.md"}
    allowed_articulation = asset.startswith("app/assets/articulation/") and asset[len("app/assets/articulation/"):] in articulation_assets
    allowed = allowed or allowed_demo or allowed_word or allowed_articulation
    if not allowed:
        raise HTTPException(404, "ไม่พบหน้านี้")
    path = (ROOT / asset).resolve()
    if not path.is_relative_to(ROOT) or not path.is_file():
        raise HTTPException(404, "ไม่พบไฟล์นี้")
    if allowed_demo and not path.is_relative_to((ROOT / "speech-training/demo-assets").resolve()):
        raise HTTPException(404, "ไม่พบไฟล์นี้")
    if allowed_word:
        word_directory = ROOT / "speech-training/word-audio"
        if word_directory.is_symlink() or not path.is_relative_to(word_directory.resolve()):
            raise HTTPException(404, "ไม่พบไฟล์นี้")
    if allowed_articulation and not path.is_relative_to((ROOT / "app/assets/articulation").resolve()):
        raise HTTPException(404, "ไม่พบไฟล์นี้")
    return FileResponse(path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8766, access_log=False)
