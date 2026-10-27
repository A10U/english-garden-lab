#!/usr/bin/env python3
"""Build the static public demo without models, datasets, raw runs or a backend.

    python3 speech-training/build_demo.py --output dist

Only the root landing page, browser runtime files from app/, listen.html and
verified demo-assets/ are used. The output is generated content; an existing
output directory must be empty or belong to an earlier build of this command.
No authoring data outside app/ and speech-training/ is read.
"""
from __future__ import annotations

import argparse
import hashlib
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import struct
from urllib.parse import parse_qsl, unquote, urlencode, urlsplit

from export_demo_assets import assert_public, verify_export, wav_info
from build_word_audio import filename as word_filename, normalize_word, verify_public as verify_word_audio


MARKER = ".egl-demo-build.json"
RUNTIME_SUFFIXES = {".html", ".js", ".mjs", ".wasm", ".txt", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2"}
EXCLUDED_PARTS = {"tests", "node_modules", "__pycache__", "logs"}
PRIVATE_PATH = re.compile(
    r"/Users/|/home/|file://|\\Users\\|(?:\.\./)*(?:Resource|SDLC|research_notes|reports|runs|models|\.venv)/"
)
LOOPBACK_URL = re.compile(r"https?://(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(?::\d+)?", re.I)
PHONETICS_SCRIPT = re.compile(r"<script\b[^>]*\bsrc\s*=\s*(['\"])((?:[^'\"]*/)?phonetics\.js)\1[^>]*>\s*</script>", re.I)
TRIAL_SCRIPT = re.compile(r"(<script\b(?=[^>]*\bid=['\"]trial-data['\"])[^>]*>).*?(</script\s*>)", re.I | re.S)
NOTICE = """<aside id="egl-hosted-demo-notice" role="note" style="margin:16px auto;padding:12px 16px;max-width:1120px;border:1px solid #c7d8bd;border-radius:12px;background:#f1f6eb;color:#234b35;font:14px/1.7 system-ui,sans-serif">
<strong>ฝึกเสียงบนเว็บ</strong> · ฟังเสียง AI พร้อมผลที่เตรียมไว้ หรือบันทึกและวิเคราะห์เสียงของคุณในเบราว์เซอร์ เมื่อกดวิเคราะห์ครั้งแรกจะดาวน์โหลดโมเดลประมาณ 318 MB และชุดประมวลผลประมาณ 12 MB เสียงของคุณไม่ถูกส่งออกจากเบราว์เซอร์ เครื่องที่ช้าอาจใช้เวลารอ
 · <a href="../speech-training/demo-assets/ATTRIBUTION.txt">ที่มาของเสียงตัวอย่าง</a></aside>"""
CSP = '<meta id="egl-demo-csp" http-equiv="Content-Security-Policy" content="connect-src \'self\' https://huggingface.co https://*.hf.co; worker-src \'self\' blob:; media-src \'self\' blob: data:; object-src \'none\'; base-uri \'self\'">'
MODEL_REPOSITORY = "https://huggingface.co/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX/"
MODEL_URL = MODEL_REPOSITORY + "resolve/c69750f5043e5e1f8a71ab95dd3b98338c280c92/onnx/model_quantized.onnx"
BROWSER_ASSETS = (
    "app/microphone-processor.js",
    "app/sound-foundations.js", "app/vowel-pairs.js", "app/vowel-audio.js", "app/pronunciation-videos.js",
    "app/articulation-images.js", "app/spelling-guide.js", "app/spelling-feedback.js", "app/word-audio.js",
    "app/browser-phonetics.js", "app/browser-phonetics-worker.js", "app/browser-phoneme-model.js",
    "app/phonetic-alignment.js", "app/vendor/onnxruntime/ort.wasm.min.js",
    "app/vendor/onnxruntime/ort-wasm-simd-threaded.mjs",
    "app/vendor/onnxruntime/ort-wasm-simd-threaded.wasm",
    "app/vendor/onnxruntime/LICENSE.txt", "app/vendor/onnxruntime/ThirdPartyNotices.txt",
)
ARTICULATION_CREDIT_ASSETS = (
    "app/assets/articulation/ATTRIBUTION.json", "app/assets/articulation/ATTRIBUTION.md",
)
VOWEL_AUDIO_FILES = {
    "vowel-i.ogg", "vowel-ih.ogg", "vowel-u.ogg", "vowel-uh.ogg", "vowel-epsilon.ogg",
    "vowel-ae.ogg", "vowel-strut.ogg", "vowel-alpha.ogg", "vowel-schwa.ogg", "vowel-open-o.ogg",
    "vowel-open-back-rounded.ogg", "vowel-open-central.ogg",
}
# Unmodified ONNX Runtime Web 1.23.2 distribution plus upstream license/notices.
# Emscripten embeds a virtual /home/web_user and a file:// scheme detector;
# these upstream literals are allowed only when the complete file hash matches.
VENDOR_SHA256 = {
    "app/vendor/onnxruntime/LICENSE.txt": "2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c",
    "app/vendor/onnxruntime/ThirdPartyNotices.txt": "e9e90971a8e75a9a8ac0c6412e29c1202d079998389915aa485f46c816c3b4cc",
    "app/vendor/onnxruntime/ort-wasm-simd-threaded.mjs": "90a557d15c02bac4504d95b67f431d8594635ed2a0a62a7f2cd83d090ff91d3e",
    "app/vendor/onnxruntime/ort-wasm-simd-threaded.wasm": "45eaee27761ad883742a8d4b8fce1538d60ce43b51adf1726fafccc59b8c1a15",
    "app/vendor/onnxruntime/ort.wasm.min.js": "c6bc9f8e1d0ecc3983a57910e6a30b2230a512bcd2e0207cd64306459c3de7b4",
}


def script_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


def verified_word_assets(root: Path) -> tuple[dict[str, bytes], dict]:
    """Copy only complete standalone recordings named by the verified manifest."""
    directory = root / "speech-training/word-audio"
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError("Missing or symlinked standalone word audio directory")
    metadata = {"manifest.json", "ATTRIBUTION.txt", "SHA256SUMS"}
    for name in metadata:
        path = directory / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Missing or symlinked standalone word metadata: {name}")
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    assert_public(manifest, "standalone word manifest")
    records = manifest.get("by_word")
    if not isinstance(records, dict) or not records:
        raise ValueError("Standalone word manifest requires at least one complete word")
    lookup = root / "app/word-audio.js"
    if not lookup.is_file() or lookup.is_symlink():
        raise ValueError("Missing or symlinked standalone word lookup: app/word-audio.js")
    assignment = re.fullmatch(
        r"\s*(?:(?:/\*.*?\*/|//[^\n]*)\s*)*globalThis\.EGL_WORD_AUDIO\s*=\s*(\{.*\})\s*;\s*",
        lookup.read_text(encoding="utf-8"), re.S)
    if not assignment or json.loads(assignment[1]) != manifest:
        raise ValueError("Standalone word lookup differs from its verified manifest")
    for word, record in records.items():
        if normalize_word(word) != word or not isinstance(record, dict):
            raise ValueError("Invalid standalone word record")
        if normalize_word(record.get("text")) != word:
            raise ValueError("Standalone word text differs from its lookup key")
        reference = record.get("reference")
        words = reference.get("words") if isinstance(reference, dict) else None
        if (not reference or reference.get("text") != record["text"] or reference.get("accent") != "en-us"
                or reference.get("analysis_type") != "text_pronunciation_reference" or reference.get("audio_analyzed") is not False
                or not isinstance(words, list) or len(words) != 1 or not isinstance(words[0], dict)
                or words[0].get("index") != 0 or normalize_word(words[0].get("text")) != word
                or not isinstance(words[0].get("phones"), list) or not words[0]["phones"]
                or any(not isinstance(phone, str) or not phone.strip() for phone in words[0]["phones"])):
            raise ValueError("Standalone word requires its actual isolated text-pronunciation reference")
        path = directory / word_filename(word)
        if not path.is_file() or path.is_symlink() or path.resolve().parent != directory.resolve():
            raise ValueError("Standalone word audio must remain inside its public directory")
        actual = wav_info(path.read_bytes())
        if actual["bits_per_sample"] != 16 or actual["samples"] != record.get("samples"):
            raise ValueError("Standalone word WAV sample data differs from its metadata")
    verified = verify_word_audio(directory)
    names = metadata | {word_filename(word) for word in records}
    files = {"speech-training/word-audio/" + name: (directory / name).read_bytes() for name in sorted(names)}
    return files, {"standalone_words": verified["words"], "standalone_audio_bytes": verified["audio_bytes"]}


def ogg_vorbis_info(data: bytes) -> dict:
    """Read complete Ogg pages and Vorbis timing without a playback dependency."""
    offset = 0
    rate = channels = serial = None
    final_granule = 0
    ended = False
    while offset < len(data):
        if offset + 27 > len(data) or data[offset:offset + 5] != b"OggS\x00":
            raise ValueError("Incomplete Ogg Vorbis page")
        segments = data[offset + 26]
        body_start = offset + 27 + segments
        if body_start > len(data):
            raise ValueError("Truncated Ogg page segment table")
        body_end = body_start + sum(data[offset + 27:body_start])
        if body_end > len(data):
            raise ValueError("Truncated Ogg page data")
        current_serial = struct.unpack_from("<I", data, offset + 14)[0]
        if serial is not None and serial != current_serial:
            raise ValueError("Expected one Vorbis stream")
        serial = current_serial
        if rate is None:
            body = data[body_start:body_end]
            if len(body) < 30 or body[:7] != b"\x01vorbis" or struct.unpack_from("<I", body, 7)[0] != 0:
                raise ValueError("Expected an Ogg Vorbis identification packet")
            channels = body[11]
            rate = struct.unpack_from("<I", body, 12)[0]
            if not channels or not rate:
                raise ValueError("Invalid Vorbis channel count or sample rate")
        granule = struct.unpack_from("<Q", data, offset + 6)[0]
        if granule != 0xffffffffffffffff:
            final_granule = max(final_granule, granule)
        ended = ended or bool(data[offset + 5] & 4)
        offset = body_end
    if not ended or not final_granule or not rate:
        raise ValueError("Missing complete Vorbis audio duration")
    return {"sample_rate": rate, "channels": channels, "duration_seconds": final_granule / rate}


def verified_vowel_assets(root: Path) -> tuple[dict[str, bytes], dict]:
    directory = root / "app/assets/vowels"
    names = {"manifest.json", "ATTRIBUTION.md"}
    if not directory.is_dir() or directory.is_symlink():
        raise ValueError("Missing or symlinked human vowel audio directory")
    for name in names:
        path = directory / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Missing or symlinked vowel audio metadata: {name}")
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    assert_public(manifest, "human vowel audio manifest")
    recordings = manifest.get("recordings")
    if manifest.get("schema_version") != 1 or not isinstance(recordings, list) or not recordings:
        raise ValueError("Human vowel audio manifest requires recordings")
    symbols = set()
    total = 0
    for record in recordings:
        if not isinstance(record, dict) or record.get("filename") not in VOWEL_AUDIO_FILES or record["filename"] in names:
            raise ValueError("Invalid or duplicate human vowel recording filename")
        symbol = record.get("symbol")
        if not isinstance(symbol, str) or not symbol or symbol in symbols:
            raise ValueError("Invalid or duplicate human vowel symbol")
        symbols.add(symbol)
        name = record["filename"]
        path = directory / name
        if not path.is_file() or path.is_symlink() or path.resolve().parent != directory.resolve():
            raise ValueError("Human vowel audio must remain inside its public directory")
        audio = path.read_bytes()
        if len(audio) != record.get("bytes") or hashlib.sha256(audio).hexdigest() != record.get("sha256"):
            raise ValueError("Human vowel audio hash or byte length mismatch")
        actual = ogg_vorbis_info(audio)
        duration = record.get("duration_seconds")
        if (not isinstance(duration, (int, float)) or isinstance(duration, bool) or not math.isfinite(duration)
                or not 0 < duration <= 30 or abs(duration - actual["duration_seconds"]) > max(1 / actual["sample_rate"], 1e-5)
                or actual["sample_rate"] != record.get("sample_rate") or actual["channels"] != record.get("channels")):
            raise ValueError("Human vowel Vorbis timing or format metadata mismatch")
        if (record.get("changes") != "unmodified" or not record.get("author") or not record.get("license")
                or any(not isinstance(record.get(key), str) or not record[key].startswith("https://") for key in ("source", "licenseURL"))):
            raise ValueError("Human vowel audio requires original source and license credits")
        names.add(name)
        total += len(audio)
    module = root / "app/vowel-audio.js"
    if not module.is_file() or module.is_symlink():
        raise ValueError("Missing or symlinked human vowel audio module")
    linked = set(re.findall(r"assets/vowels/([a-z0-9_-]+\.ogg)", module.read_text(encoding="utf-8")))
    if linked != names - {"manifest.json", "ATTRIBUTION.md"}:
        raise ValueError("Human vowel module differs from its recording manifest")
    files = {"app/assets/vowels/" + name: (directory / name).read_bytes() for name in sorted(names)}
    return files, {"human_vowels": len(recordings), "human_vowel_audio_bytes": total}


def public_trial_payload(demo: dict) -> dict:
    """Keep the inline page's pair/ratings shape while omitting private inputs."""
    value = {"schema_version": 1, "pairs": demo["pairs"], "training": demo.get("training", {}),
             "settings_differences": [], "public_demo": True,
             "quality_claim": "Prerecorded AI samples and cached phone comparisons; no learner grade or established naturalness improvement."}
    assert_public(value)
    return value


def disable_local_api_literals(text: str) -> str:
    # These changes affect generated public copies only. The local source
    # edition keeps its loopback API. Demo-mode guards are also set explicitly.
    text = re.sub(r"\bapiBase\s*:\s*(['\"])https?://(?:127\.0\.0\.1|localhost)(?::\d+)?\1", "apiBase:null", text)
    text = re.sub(r"(['\"])https?://(?:127\.0\.0\.1|localhost)(?::\d+)?\1", "location.origin", text)
    return text


def demo_html(source: str, *, data_url: str, trial: dict | None = None, runtime_version: str | None = None) -> str:
    if trial is not None:
        source, count = TRIAL_SCRIPT.subn(lambda match: match[1] + script_json(trial) + match[2], source)
        if count != 1:
            raise ValueError("Listening HTML must have exactly one trial-data script")
        # Older local templates describe an omitted adapter as 'none'. Public
        # data deliberately omits that private metadata rather than asserting
        # that the trained sample has no adapter.
        source = source.replace("const adapter=data.candidate_adapter?String(data.candidate_adapter).split('/').pop():'ไม่มี adapter';",
                                "const adapter='ข้อมูลรุ่นไม่แสดงในเดโมสาธารณะ';")
    source = disable_local_api_literals(source)
    source = re.sub(r"<script\b(?=[^>]*\bid=['\"]egl-demo-runtime['\"])[^>]*>.*?</script>\s*", "", source, flags=re.I | re.S)
    source = re.sub(r"<script\b[^>]*src=['\"][^'\"]*demo-data\.js['\"][^>]*>\s*</script>\s*", "", source, flags=re.I)
    def inject(match):
        defer = " defer" if re.search(r"\bdefer\b", match[0], re.I) else ""
        return ('<script id="egl-demo-runtime">globalThis.EGL_DEMO_RUNTIME={mode:"demo",apiBase:null};</script>\n'
                + f'<script src="{data_url}"{defer}></script>\n' + match[0])
    source, count = PHONETICS_SCRIPT.subn(inject, source)
    if count != 1:
        raise ValueError("A runtime page must include phonetics.js exactly once")
    if runtime_version:
        def version_script(match):
            prefix, quote, url = match.groups()
            parsed = urlsplit(url)
            if parsed.scheme or parsed.netloc or Path(parsed.path).name not in {"phonetics.js", "browser-phonetics.js", "spelling-feedback.js"}:
                return match[0]
            query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key != "v"]
            versioned = parsed._replace(query=urlencode(query + [("v", runtime_version)])).geturl()
            return prefix + quote + versioned + quote
        source = re.sub(r"(<script\b[^>]*\bsrc\s*=\s*)(['\"])([^'\"]+)\2", version_script, source, flags=re.I)
    if 'id="egl-demo-csp"' not in source:
        source = re.sub(r"</head\s*>", CSP + "\n</head>", source, count=1, flags=re.I)
    if 'id="egl-hosted-demo-notice"' not in source:
        source, count = re.subn(r"(<body\b[^>]*>)", lambda match: match[1] + "\n" + NOTICE, source, count=1, flags=re.I)
        if count != 1:
            raise ValueError("HTML page has no body for demo notice")
    return source


class LocalReferences(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if value and key in {"href", "src", "poster"}:
                self.links.append((tag, key, value))


def validate_files(files: dict[str, bytes]) -> None:
    """Catch stale authoring links and broken local runtime assets before writes."""
    for name in BROWSER_ASSETS:
        if name not in files:
            raise ValueError(f"Missing browser phoneme runtime asset: {name}")
    for name in ARTICULATION_CREDIT_ASSETS:
        if name not in files:
            raise ValueError(f"Missing public articulation credit asset: {name}")
    for name, raw in files.items():
        if name in VENDOR_SHA256:
            if hashlib.sha256(raw).hexdigest() != VENDOR_SHA256[name]:
                raise ValueError(f"Vendored runtime integrity check failed: {name}")
            continue
        suffix = Path(name).suffix.lower()
        if suffix not in {".html", ".js", ".mjs", ".css", ".json", ".txt", ".md"}:
            continue
        text = raw.decode("utf-8")
        if PRIVATE_PATH.search(text):
            raise ValueError(f"Private/authoring path remains in public file: {name}")
        if LOOPBACK_URL.search(text):
            raise ValueError(f"Loopback URL remains in public file: {name}")
        if name == "app/browser-phoneme-model.js":
            # A public model is fetched on demand; keep the allowed executable
            # model URL pinned rather than accepting arbitrary remote weights.
            model_urls = re.findall(r"https://[^\s\"'`<>]+\.onnx(?:\?[^\s\"'`<>]*)?", text)
            if model_urls != [MODEL_URL]:
                raise ValueError("Browser phoneme metadata must name only the pinned public ONNX model URL")
        if suffix != ".html":
            continue
        parser = LocalReferences()
        parser.feed(text)
        for tag, attribute, url in parser.links:
            parsed = urlsplit(url)
            if parsed.scheme or parsed.netloc:
                if tag != "a" and parsed.scheme not in {"data", "blob"}:
                    raise ValueError(f"Runtime asset requires an external host: {name}: {url}")
                continue
            if not parsed.path:
                continue
            if parsed.path.startswith("/"):
                raise ValueError(f"Root-absolute asset/link loses hosted site prefix: {name}: {url}")
            parts = list(Path(name).parent.parts)
            for part in Path(unquote(parsed.path)).parts:
                if part == "..":
                    if not parts:
                        raise ValueError(f"Link leaves public site: {name}: {url}")
                    parts.pop()
                elif part != ".":
                    parts.append(part)
            target = "/".join(parts)
            if parsed.path.endswith("/"):
                target += "/index.html"
            if target not in files:
                raise ValueError(f"Missing public link/asset: {name}: {url}")


def build(project_root: Path, output: Path) -> dict:
    root, output = project_root.resolve(), output.resolve()
    if output == root or output in root.parents or output in {root / "app", root / "speech-training"}:
        raise ValueError("Choose a generated output directory, not a source directory")
    exported = root / "speech-training/demo-assets"
    export_summary = verify_export(exported)
    word_files, word_summary = verified_word_assets(root)
    vowel_files, vowel_summary = verified_vowel_assets(root)
    demo = json.loads((exported / "demo-data.json").read_text(encoding="utf-8"))
    files = {"index.html": (root / "index.html").read_bytes(), ".nojekyll": b""}
    files.update(word_files)
    files.update(vowel_files)
    app_source = root / "app"
    for path in sorted(app_source.rglob("*")):
        relative = path.relative_to(app_source)
        if relative.as_posix() == "phone-examples.js":
            continue
        if relative.parts[:2] == ("assets", "vowels"):
            continue
        public_credit = "app/" + relative.as_posix() in ARTICULATION_CREDIT_ASSETS
        if not path.is_file() or (path.suffix.lower() not in RUNTIME_SUFFIXES and not public_credit):
            continue
        if path.suffix.lower() == ".txt" and relative.parts[:2] != ("vendor", "onnxruntime"):
            continue
        if any(part.startswith(".") or part in EXCLUDED_PARTS for part in relative.parts):
            continue
        if path.is_symlink():
            raise ValueError("Public app runtime must not contain symlinked files")
        data = path.read_bytes()
        if path.suffix.lower() == ".js":
            data = disable_local_api_literals(data.decode("utf-8")).encode("utf-8")
        files["app/" + relative.as_posix()] = data
    for path in sorted(exported.rglob("*")):
        if not path.is_file():
            continue
        if path.is_symlink():
            raise ValueError("Public demo assets must not contain symlinked files")
        relative = path.relative_to(exported).as_posix()
        # Copy only manifest-verified assets; no unrelated private/export files.
        if relative == "SHA256SUMS" or relative in {"demo-data.json", "ATTRIBUTION.txt"} or any(item["path"] == relative for item in demo["inventory"]):
            files["speech-training/demo-assets/" + relative] = path.read_bytes()
    files["speech-training/demo-assets/demo-data.js"] = (
        "/* Curated prerecorded AI demo data; no live learner analysis. */\n"
        "globalThis.EGL_DEMO_DATA=" + script_json(demo) + ";\n").encode("utf-8")
    files["app/reference-audio.js"] = (
        "/* Curated public AI recording references. */\nglobalThis.EGL_REFERENCE_AUDIO="
        + script_json(demo["reference_audio"]["by_text"]) + ";\n").encode("utf-8")
    files["app/phonetic-data.js"] = (
        "/* Precomputed expected text pronunciation references. */\nglobalThis.EGL_PHONETIC_DATA="
        + script_json(demo["texts"]) + ";\n").encode("utf-8")
    # One content version also invalidates dynamically loaded workers/worklets
    # when their implementation changes without a change to the entry scripts.
    runtime_version = hashlib.sha256(b"".join(
        name.encode("utf-8") + b"\0" + hashlib.sha256(content).digest()
        for name, content in sorted(files.items()) if name.startswith("app/") and name.endswith(".js")
    )).hexdigest()[:16]
    files["app/index.html"] = demo_html(files["app/index.html"].decode("utf-8"),
        data_url="../speech-training/demo-assets/demo-data.js", runtime_version=runtime_version).encode("utf-8")
    files["speech-training/listen.html"] = demo_html(
        (root / "speech-training/listen.html").read_text(encoding="utf-8"),
        data_url="demo-assets/demo-data.js", trial=public_trial_payload(demo), runtime_version=runtime_version).encode("utf-8")
    validate_files(files)
    previous = set()
    if output.exists():
        current = {path.relative_to(output).as_posix() for path in output.rglob("*") if path.is_file()}
        marker = output / MARKER
        if current and not marker.is_file():
            raise ValueError("Output is not empty and has no demo build marker; choose an empty directory")
        if marker.is_file():
            previous = set(json.loads(marker.read_text(encoding="utf-8"))["files"])
            if current - previous - {MARKER}:
                raise ValueError("Output has files not owned by the previous demo build")
    for name, content in sorted(files.items()):
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    for stale in previous - set(files):
        (output / stale).unlink(missing_ok=True)
    manifest = {"schema_version": 1, "mode": "demo", "files": {
        name: hashlib.sha256(content).hexdigest() for name, content in sorted(files.items())}}
    (output / MARKER).write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    verify_export(output / "speech-training/demo-assets")
    return {"mode": "demo", "files": len(files) + 1, "bytes": sum(map(len, files.values())), **export_summary, **word_summary, **vowel_summary}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.project_root, args.output or args.project_root / "dist"), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
