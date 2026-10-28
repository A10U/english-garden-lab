"""Prepare a small, attributed human-word reference set from public sources.

No provider keys, learner recordings, training, or paid calls. A dictionary
reference is not a human phonetic annotation of the actual recorded waveform.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
GROUPS = [
    ("vowels", "เริ่มจากสระ", ["it", "bit", "beat", "sit", "seat", "ship", "sheep", "see"]),
    ("th", "ลิ้นกับเสียง th", ["this", "that", "these", "those", "thin", "then", "think", "three"]),
    ("endings", "เสียงท้ายและเสียงที่คล้ายกัน", ["leaf", "leave", "lip", "leap", "light", "right", "write", "it's"]),
    ("everyday", "คำที่ใช้ทุกวัน", ["with", "we", "you", "what", "where", "when", "who", "why", "how", "yes", "no", "can", "can't", "want", "water", "work"]),
]
WORDS = [word for _, _, words in GROUPS for word in words]
NATIVE_PROFILES = {name: "https://commons.wikimedia.org/wiki/User:" + name for name in ("Muke", "Dvortygirl")}
LICENSES = {"Public domain", "CC BY-SA 3.0"}
AGENT = "EnglishGardenCoreWords/0.1 (https://github.com/A10U/english-garden-lab; educational audio references)"


def fetch(url, maximum=8 * 1024 * 1024):
    req = urllib.request.Request(url, headers={"User-Agent": AGENT})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                data = response.read(maximum + 1)
                if len(data) > maximum:
                    raise ValueError("Public source exceeded its download bound")
                return data
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == 3: raise
            delay = error.headers.get("Retry-After", "")
            seconds = float(delay) if delay.isdigit() else 2 ** (attempt + 1)
            if seconds > 30: raise
            time.sleep(max(1, seconds))


def plain(value):
    return html.unescape(re.sub(r"<[^>]*>", "", value or "")).strip()


def dictionary():
    commit = json.loads(fetch("https://api.github.com/repos/cmusphinx/cmudict/commits/master"))["sha"]
    if not re.fullmatch(r"[a-f0-9]{40}", commit): raise ValueError("Missing immutable dictionary revision")
    base = "https://raw.githubusercontent.com/cmusphinx/cmudict/" + commit + "/"
    raw, license_data = fetch(base + "cmudict.dict"), fetch(base + "LICENSE")
    entries = {word: [] for word in WORDS}
    for line in raw.decode().splitlines():
        parts = line.split()
        if len(parts) < 2: continue
        word = re.sub(r"\(\d+\)$", "", parts[0])
        if word in entries: entries[word].append(parts[1:])
    if any(not entries[word] for word in WORDS): raise ValueError("A target lacks a dictionary pronunciation")
    return entries, {"name": "CMUdict", "revision": commit, "url": "https://github.com/cmusphinx/cmudict",
                     "sha256": hashlib.sha256(raw).hexdigest(), "license_url": base + "LICENSE"}, license_data


def prepare():
    from phonetic_engine import PhoneticAnalyzer
    from build_word_audio import isolated_reference
    from export_demo_assets import wav_info
    out = ROOT / "app/assets/native-words"; out.mkdir(parents=True, exist_ok=True)
    cache = HERE / "data/core-word-sources"; cache.mkdir(parents=True, exist_ok=True)
    entries, dict_source, license_data = dictionary()
    (out / "CMUDICT-LICENSE.txt").write_bytes(license_data)
    params = {"action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url|extmetadata|sha1|size|timestamp|user",
              "titles": "|".join("File:En-us-" + word + ".ogg" for word in WORDS)}
    pages = json.loads(fetch("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)))["query"]["pages"].values()
    by_title = {page["title"]: page for page in pages}
    analyzer = PhoneticAnalyzer()

    def word_record(word):
        title = "File:En-us-" + word + ".ogg"
        page = by_title.get(title, {})
        info = page.get("imageinfo", [{}])[0]; metadata = info.get("extmetadata", {})
        value = lambda key: metadata.get(key, {}).get("value", "")
        author = plain(value("Artist")) or info.get("user", "")
        native = next((name for name in NATIVE_PROFILES if author == name), None)
        base = {"word": word, "arpabet_variants": entries[word], "dictionary_source": dict_source["url"],
                "group": next(key for key, _, words in GROUPS if word in words),
                "reference": isolated_reference(analyzer, word),
                "assessment_label": "canonical_text_reference_not_expert_audio_annotation"}
        if "missing" in page or not info.get("url") or value("LicenseShortName") not in LICENSES or native is None:
            return {**base, "available": False, "reason": "No approved audio/license/self-declared native-speaker provenance in this pass"}
        original = urllib.parse.urlunsplit(urllib.parse.urlsplit(info["url"])._replace(query="", fragment=""))
        if urllib.parse.urlsplit(original).netloc != "upload.wikimedia.org" or not 0 < info.get("size", 0) <= 512 * 1024:
            raise ValueError("Unexpected public audio URL or size")
        cached = next((path for path in cache.glob("*.ogg") if hashlib.sha1(path.read_bytes()).hexdigest() == info["sha1"]), None)
        if cached:
            raw = cached.read_bytes()
        else:
            time.sleep(1)
            raw = fetch(original, 512 * 1024)
        if len(raw) != info["size"] or hashlib.sha1(raw).hexdigest() != info["sha1"]:
            raise ValueError("Public source audio failed size/SHA1 verification")
        source_hash = hashlib.sha256(raw).hexdigest()
        source = cache / (source_hash + ".ogg"); source.write_bytes(raw)
        name = "word-" + source_hash[:20] + ".wav"; destination = out / name
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-map_metadata", "-1", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(destination)], check=True)
        data = destination.read_bytes(); metrics = wav_info(data)
        return {**base, "available": True, "source_kind": "human", "standalone": True,
                "url": "assets/native-words/" + name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                "duration_seconds": metrics["duration_seconds"], "source_page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title, safe=":"),
                "source_url": original, "source_sha1": info["sha1"], "source_sha256": source_hash,
                "source_timestamp": info["timestamp"], "author": author, "license": value("LicenseShortName"),
                "license_url": value("LicenseUrl") or "https://commons.wikimedia.org/wiki/Template:PD-self",
                "speaker_profile": NATIVE_PROFILES[native], "native_status": "self-declared native English on contributor profile; not independently certified",
                "changes": "OGG Vorbis converted to mono 24kHz PCM16 WAV; no trimming, normalization or synthetic speech",
                "audio_label_review": "source filename/metadata plus dictionary cross-reference; no expert listening review"}

    # Phonemizer/eSpeak configuration is process-global: keep annotation work
    # sequential rather than racing independent library instances.
    records = []
    priority = ["this", "thin", "with", "leaf", "it's", "sit", "seat", "ship", "sheep"]
    for word in list(dict.fromkeys(priority + WORDS)):
        records.append(word_record(word))
        print(json.dumps({"word": word, "human_audio": records[-1]["available"]}), flush=True)
    records.sort(key=lambda item: WORDS.index(item["word"]))
    document = {"schema_version": 1, "accent": "en-us", "purpose": "Basic word listening/practice and independent evaluation; not expert grading labels",
                "dictionary": dict_source, "groups": [{"id": key, "title": title, "words": words} for key, title, words in GROUPS],
                "words": records, "training_performed": False,
                "limitations": ["Single recordings per word are insufficient for a general recognition model.",
                                "Canonical dictionary references may differ from legitimate variants/allophones in a recording.",
                                "Audio with matching source hashes is one recording, including homophones/redirects; do not split duplicates across train/test."]}
    (out / "ATTRIBUTION.json").write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    credits = ["# เสียงคำศัพท์จากผู้พูดจริง", "", "ไฟล์ WAV คง license ของเสียงต้นฉบับแต่ละรายการ เก็บเครดิตและเงื่อนไขพร้อมไฟล์เมื่อแจกจ่ายต่อ", "", "คำอ่านเป็น canonical reference ไม่ใช่การให้คะแนนเสียงโดยผู้เชี่ยวชาญ", ""]
    for record in records:
        if record["available"]:
            credits.append("- " + record["word"] + " — " + record["author"] + ", " + record["license"] + "; " + record["source_page"] + "; " + record["license_url"] + "; " + record["changes"])
    credits.extend(["", "CMUdict: " + dict_source["url"] + " @ " + dict_source["revision"] + ". License: CMUDICT-LICENSE.txt."])
    (out / "ATTRIBUTION.md").write_text("\n".join(credits) + "\n")
    (ROOT / "app/core-word-data.js").write_text("/* Attributed human recordings and canonical word references; no expert pronunciation grades. */\nglobalThis.EGL_CORE_WORDS=" + json.dumps(document, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c") + ";\n")
    print(json.dumps({"target_words": len(records), "human_audio_words": sum(row["available"] for row in records), "paid_calls": 0, "training_performed": False}))


if __name__ == "__main__":
    prepare()
