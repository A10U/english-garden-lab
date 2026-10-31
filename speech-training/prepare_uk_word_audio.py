"""Add explicitly licensed UK whole-word recordings; no credentials or training."""
import hashlib
import json
import subprocess
import time
from pathlib import Path
import urllib.parse
from prepare_core_word_audio import ROOT, HERE, WORDS, fetch, plain, write_corpus
from phonetic_engine import PhoneticAnalyzer
from export_demo_assets import wav_info


def prepare():
    directory = ROOT / "app/assets/native-words"
    document = json.loads((directory / "ATTRIBUTION.json").read_text())
    params = {"action": "query", "format": "json", "prop": "imageinfo", "iiprop": "url|extmetadata|sha1|size|timestamp|user",
              "titles": "|".join("File:En-uk-" + word + ".ogg" for word in WORDS)}
    metadata = json.loads(fetch("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(params)))
    pages = {page["title"]: page for page in metadata["query"]["pages"].values()}
    originals = {row["word"]: row for row in document["words"] if row.get("accent", "en-us") == "en-us"}
    cache = HERE / "data/core-word-sources"; cache.mkdir(parents=True, exist_ok=True)
    analyzer = PhoneticAnalyzer(); records = []
    for word in WORDS:
        title = "File:En-uk-" + word + ".ogg"; page = pages.get(title, {})
        info = page.get("imageinfo", [{}])[0]; fields = info.get("extmetadata", {})
        value = lambda key: plain(fields.get(key, {}).get("value", ""))
        # This first UK set has a specific documented speaker/location and
        # license. Other contributors are left for a separate provenance pass.
        if (not info.get("url") or value("Artist") != "Association Shtooka, Judith Franck"
            or value("LicenseShortName") != "CC BY 3.0 us" or "Speaker from London, England" not in value("ImageDescription")):
            continue
        original = urllib.parse.urlunsplit(urllib.parse.urlsplit(info["url"])._replace(query="", fragment=""))
        if urllib.parse.urlsplit(original).netloc != "upload.wikimedia.org" or not 0 < info["size"] <= 512 * 1024:
            raise ValueError("Unexpected UK audio URL/size")
        cached = next((path for path in cache.glob("*.ogg") if hashlib.sha1(path.read_bytes()).hexdigest() == info["sha1"]), None)
        if cached: raw = cached.read_bytes()
        else:
            time.sleep(1); raw = fetch(original, 512 * 1024)
        if len(raw) != info["size"] or hashlib.sha1(raw).hexdigest() != info["sha1"]:
            raise ValueError("UK source audio failed size/SHA1 verification")
        source_hash = hashlib.sha256(raw).hexdigest(); source = cache / (source_hash + ".ogg"); source.write_bytes(raw)
        name = "word-" + source_hash[:20] + ".wav"; destination = directory / name
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-map_metadata", "-1", "-ac", "1", "-ar", "24000", "-c:a", "pcm_s16le", str(destination)], check=True)
        audio = destination.read_bytes(); metrics = wav_info(audio)
        reference = analyzer.annotate_text(word, "en-gb")
        reference.update(reference_context="isolated_word", notes=["คำอ่านอ้างอิง UK แบบ canonical ไม่ใช่ผู้เชี่ยวชาญถอดเสียงของคลิปนี้"])
        page_url = "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title, safe=":")
        records.append({"word": word, "accent": "en-gb", "group": originals[word]["group"], "reference": reference,
                        "reference_source": "eSpeak NG en-gb canonical word reference; not US CMUdict", "available": True,
                        "assessment_label": "canonical_text_reference_not_expert_audio_annotation", "source_kind": "human", "standalone": True,
                        "url": "assets/native-words/" + name, "sha256": hashlib.sha256(audio).hexdigest(), "bytes": len(audio),
                        "duration_seconds": metrics["duration_seconds"], "source_page": page_url, "source_url": original,
                        "source_sha1": info["sha1"], "source_sha256": source_hash, "source_timestamp": info["timestamp"],
                        "author": value("Artist"), "license": value("LicenseShortName"),
                        "license_url": "https://creativecommons.org/licenses/by/3.0/us/", "speaker_profile": page_url,
                        "speaker_region": "London, England, according to the source file description",
                        "native_status": "UK recording and speaker location are source-described; native language not independently certified",
                        "changes": "OGG Vorbis converted to mono 24kHz PCM16 WAV; no trimming, normalization or synthetic speech",
                        "audio_label_review": "source metadata plus canonical UK reference; no expert listening review"})
        print(json.dumps({"word": word, "accent": "en-gb", "verified_download": True}), flush=True)
    if not records: raise ValueError("No approved UK recordings; existing catalog left unchanged")
    document["words"] = [row for row in document["words"] if row.get("accent", "en-us") == "en-us"] + records
    write_corpus(document)
    print(json.dumps({"uk_words": len(records), "paid_calls": 0, "training_performed": False}))


if __name__ == "__main__":
    prepare()
