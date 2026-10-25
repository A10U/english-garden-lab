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
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

from export_demo_assets import assert_public, verify_export


MARKER = ".egl-demo-build.json"
RUNTIME_SUFFIXES = {".html", ".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2"}
EXCLUDED_PARTS = {"tests", "node_modules", "__pycache__", "logs"}
PRIVATE_PATH = re.compile(
    r"/Users/|/home/|file://|\\Users\\|(?:\.\./)*(?:Resource|SDLC|research_notes|reports|runs|models|\.venv)/"
)
LOOPBACK_URL = re.compile(r"https?://(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(?::\d+)?", re.I)
PHONETICS_SCRIPT = re.compile(r"<script\b[^>]*\bsrc\s*=\s*(['\"])([^'\"]*phonetics\.js)\1[^>]*>\s*</script>", re.I)
TRIAL_SCRIPT = re.compile(r"(<script\b(?=[^>]*\bid=['\"]trial-data['\"])[^>]*>).*?(</script\s*>)", re.I | re.S)
NOTICE = """<aside id="egl-hosted-demo-notice" role="note" style="margin:16px auto;padding:12px 16px;max-width:1120px;border:1px solid #c7d8bd;border-radius:12px;background:#f1f6eb;color:#234b35;font:14px/1.7 system-ui,sans-serif">
<strong>เดโมบนเว็บ</strong> · ฟังเสียง AI และดูผลแยกเสียงที่เตรียมไว้ได้ บันทึกและฟังเสียงของคุณซ้ำได้ในเบราว์เซอร์ การวิเคราะห์เสียงของคุณแบบสดต้องใช้ฉบับในเครื่อง
 · <a href="../speech-training/demo-assets/ATTRIBUTION.txt">ที่มาของเสียงตัวอย่าง</a></aside>"""
CSP = '<meta id="egl-demo-csp" http-equiv="Content-Security-Policy" content="connect-src \'self\'; media-src \'self\' blob: data:; object-src \'none\'; base-uri \'self\'">'


def script_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")


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


def demo_html(source: str, *, data_url: str, trial: dict | None = None) -> str:
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
    for name, raw in files.items():
        suffix = Path(name).suffix.lower()
        if suffix not in {".html", ".js", ".css", ".json", ".txt"}:
            continue
        text = raw.decode("utf-8")
        if PRIVATE_PATH.search(text):
            raise ValueError(f"Private/authoring path remains in public file: {name}")
        if LOOPBACK_URL.search(text):
            raise ValueError(f"Loopback URL remains in public file: {name}")
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
    demo = json.loads((exported / "demo-data.json").read_text(encoding="utf-8"))
    files = {"index.html": (root / "index.html").read_bytes(), ".nojekyll": b""}
    app_source = root / "app"
    for path in sorted(app_source.rglob("*")):
        relative = path.relative_to(app_source)
        if not path.is_file() or path.suffix.lower() not in RUNTIME_SUFFIXES:
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
    files["app/index.html"] = demo_html(files["app/index.html"].decode("utf-8"),
        data_url="../speech-training/demo-assets/demo-data.js").encode("utf-8")
    files["speech-training/listen.html"] = demo_html(
        (root / "speech-training/listen.html").read_text(encoding="utf-8"),
        data_url="demo-assets/demo-data.js", trial=public_trial_payload(demo)).encode("utf-8")
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
    return {"mode": "demo", "files": len(files) + 1, "bytes": sum(map(len, files.values())), **export_summary}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.project_root, args.output or args.project_root / "dist"), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
