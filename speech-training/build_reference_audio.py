"""Prepare per-word playback examples from actual generated TTS recordings.

The local acoustic service supplies approximate word times. The original WAVs
remain intact; examples are timestamp ranges, with small bounded context pads.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parents[1]


def playback_words(words, duration):
    output = []
    for index, word in enumerate(words):
        item = {key: word.get(key) for key in ("index", "text", "ipa", "match_percent")}
        start, end = word.get("start"), word.get("end")
        item.update({"start": None, "end": None, "core_start": start, "core_end": end})
        if start is not None and end is not None and 0 <= start < end <= duration:
            left, right = max(0.0, start - 0.045), min(duration, end + 0.06)
            # Skip unaligned words when finding the neighbouring acoustic
            # interval, otherwise padding can overlap across a missing word.
            previous = next((w["end"] for w in reversed(words[:index]) if w.get("end") is not None), None)
            if previous is not None and previous <= start:
                left = max(left, (previous + start) / 2)
            following = next((w["start"] for w in words[index + 1:] if w.get("start") is not None), None)
            if following is not None and following >= end:
                right = min(right, (end + following) / 2)
            item.update({"start": round(left, 6), "end": round(right, 6)})
        output.append(item)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8766")
    parser.add_argument("--metadata", nargs="*", type=Path, default=[
        ROOT / "speech-training/runs/baseline-speaker/metadata.json",
        ROOT / "speech-training/runs/qwen3-hifi92-lora-v1/samples/metadata.json",
        ROOT / "speech-training/runs/word-practice/metadata.json",
    ])
    args = parser.parse_args()
    cache = ROOT / "speech-training/runs/reference-alignments"
    cache.mkdir(parents=True, exist_ok=True)
    source_key = hashlib.sha256((ROOT / "speech-training/phonetic_engine.py").read_bytes()).hexdigest()
    by_audio, by_text = {}, {}
    for metadata_path in args.metadata:
        metadata = json.loads(metadata_path.read_text())
        for record in metadata["results"]:
            if record.get("status") != "ok" or record.get("may_be_truncated"):
                raise ValueError("Reference speech must have completed successfully")
            audio_path = metadata_path.parent / record["file"]
            audio_sha = hashlib.sha256(audio_path.read_bytes()).hexdigest()
            cache_id = hashlib.sha256((source_key + audio_sha + record["text"]).encode()).hexdigest()
            result_path = cache / (cache_id + ".json")
            if result_path.exists():
                analysis = json.loads(result_path.read_text())
            else:
                with audio_path.open("rb") as handle:
                    response = requests.post(args.api.rstrip("/") + "/api/phonetics/analyze",
                        data={"text": record["text"], "accent": "en-us"},
                        files={"audio": (audio_path.name, handle, "audio/wav")}, timeout=90)
                response.raise_for_status()
                analysis = response.json()
                if not analysis.get("audio_analyzed"):
                    raise ValueError("Reference ranges require actual acoustic analysis")
                result_path.write_text(json.dumps(analysis, ensure_ascii=False, indent=2) + "\n")
            duration = analysis["metrics"]["duration_seconds"]
            key = audio_path.resolve().relative_to(ROOT).as_posix()
            reference = {"text": record["text"], "url": key, "audio_sha256": audio_sha,
                "duration_seconds": duration, "words": playback_words(analysis["alignment"]["words"], duration),
                "timing": "Approximate acoustic CTC times with small context pads; not expert word boundaries"}
            by_audio[key] = reference
            # Candidate and app-example metadata come after baseline metadata.
            by_text[record["text"]] = reference
            print("Prepared word examples:", key, flush=True)
    output = ROOT / "speech-training/resources/reference-audio.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"schema_version": 1, "by_audio": by_audio, "by_text": by_text}, ensure_ascii=False, indent=2) + "\n")
    app_data = {text: {**value, "url": "../" + value["url"]} for text, value in by_text.items()}
    js = json.dumps(app_data, ensure_ascii=False).replace("<", "\\u003c")
    (ROOT / "app/reference-audio.js").write_text("/* Actual generated speech examples, with approximate word playback ranges. */\nglobalThis.EGL_REFERENCE_AUDIO = " + js + ";\n")
    print(f"Ready: {len(by_audio)} recordings, {len(by_text)} unique sentences", flush=True)


if __name__ == '__main__':
    main()
