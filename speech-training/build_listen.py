#!/usr/bin/env python3
"""Build a local, offline A/B listening page from TTS synthesis metadata.

Example:
  python speech-training/build_listen.py \
    --baseline speech-training/runs/baseline-speaker/metadata.json \
    --candidate speech-training/runs/candidate/metadata.json \
    --training-result speech-training/runs/training/result.json

Only this command's requested HTML output is written. WAV files remain separate
local assets, addressed relative to the HTML. Phonetic analysis starts only after
an explicit action, using the browser model in the hosted demo or local service.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import html
import json
import math
import os
from pathlib import Path
from urllib.parse import quote


def load_json(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"Expected a JSON object: {path}")
    return value


def metadata_path(path: Path) -> Path:
    return (path / "metadata.json" if path.is_dir() else path).resolve()


def local_url(path: Path, output: Path) -> str:
    return quote(os.path.relpath(path.resolve(), output.parent.resolve()), safe="/")


def public_label(value: object) -> str | None:
    """Name a model or adapter without publishing a developer's home path."""
    if not isinstance(value, str) or not value.strip():
        return None
    return value.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]


def provenance_reference(path: Path, output: Path, project_root: Path) -> str:
    """Use a local relative URL, or a filename for input outside the checkout."""
    try:
        path.resolve().relative_to(project_root)
    except ValueError:
        return path.name
    return local_url(path, output)


def indexed_results(metadata: dict, path: Path) -> dict[str, dict]:
    results = metadata.get("results")
    if not isinstance(results, list) or not results:
        raise ValueError(f"No synthesis results in {path}")
    indexed = {}
    for result in results:
        if not isinstance(result, dict):
            raise ValueError(f"Malformed synthesis result in {path}")
        for key in ("id", "text", "file"):
            if not isinstance(result.get(key), str) or not result[key]:
                raise ValueError(f"Missing {key!r} in {path}")
        if result.get("status") != "ok":
            raise ValueError(f"Synthesis is not successful: {result['id']} in {path}")
        if result["id"] in indexed:
            raise ValueError(f"Duplicate prompt ID {result['id']} in {path}")
        audio = path.parent / result["file"]
        if not audio.is_file():
            raise ValueError(f"Audio file does not exist: {audio}")
        indexed[result["id"]] = result
    return indexed


def finite_number(value: object) -> float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return float(value)
    return None


def number_text(value: object, places: int = 4) -> str:
    value = finite_number(value)
    return f"{value:.{places}f}" if value is not None else "ไม่ได้บันทึก"


def build(baseline_path: Path, candidate_path: Path, result_path: Path, output: Path,
          phonetics_data: Path | None = None, reference_data: Path | None = None) -> str:
    baseline, candidate, training = (load_json(path) for path in [baseline_path, candidate_path, result_path])
    project_root = Path(__file__).resolve().parent.parent
    resources = Path(__file__).resolve().parent / "resources"
    phonetics_data = phonetics_data if phonetics_data is not None else resources / "phonetics.json"
    reference_data = reference_data if reference_data is not None else resources / "reference-audio.json"
    prompt_lookup = {}
    prompt_source = baseline.get("prompts_source")
    prompt_path = Path(prompt_source) if isinstance(prompt_source, str) and prompt_source else resources / "evaluation-prompts.json"
    if not prompt_path.is_file():
        prompt_path = resources / "evaluation-prompts.json"
    if prompt_path.is_file():
        prompts = load_json(prompt_path).get("prompts", [])
        if isinstance(prompts, list):
            prompt_lookup = {item["id"]: item for item in prompts
                             if isinstance(item, dict) and isinstance(item.get("id"), str)}
    phonetic_lookup = {}
    reference_lookup = {}
    reference_hashes = {}
    if reference_data is not None and reference_data.is_file():
        references = load_json(reference_data)
        reference_lookup = references.get("by_audio", {})
        if not isinstance(reference_lookup, dict):
            raise ValueError("Reference audio data must contain a by_audio mapping")
        reference_lookup = dict(reference_lookup)
        by_text = references.get("by_text", {})
        if isinstance(by_text, dict):
            for reference in by_text.values():
                if isinstance(reference, dict) and isinstance(reference.get("url"), str):
                    reference_lookup.setdefault(reference["url"], reference)
        for key, reference in list(reference_lookup.items()):
            if isinstance(key, str):
                normalized_key = key.replace("\\", "/")
                if normalized_key.startswith("../speech-training/"):
                    normalized_key = normalized_key[3:]
                reference_lookup.setdefault(normalized_key, reference)
            if isinstance(reference, dict) and isinstance(reference.get("audio_sha256"), str) and isinstance(reference.get("text"), str):
                reference_hashes[(reference["audio_sha256"], reference["text"])] = reference
    if phonetics_data is not None and phonetics_data.is_file():
        phonetic_data = load_json(phonetics_data)
        phonetic_lookup = phonetic_data.get("texts", phonetic_data)
        if not isinstance(phonetic_lookup, dict):
            raise ValueError("Phonetics data must map each English text to its analysis")
    before = indexed_results(baseline, baseline_path)
    after = indexed_results(candidate, candidate_path)
    if set(before) != set(after):
        raise ValueError("Baseline and candidate must contain exactly the same prompt IDs")
    differences = [key for key in ("model", "reference_audio_sha256", "conditioning", "base_seed", "settings")
                   if baseline.get(key) != candidate.get(key)]
    pairs = []
    for prompt_id, left in before.items():
        right = after[prompt_id]
        if left["text"] != right["text"]:
            raise ValueError(f"Prompt texts differ for {prompt_id}")
        if left.get("seed") != right.get("seed"):
            differences.append(f"seed:{prompt_id}")
        prompt_info = prompt_lookup.get(prompt_id, {})
        category = prompt_info.get("category") if prompt_info.get("text") == left["text"] else None
        pair = {"id": prompt_id, "text": left["text"], "precomputed": phonetic_lookup.get(left["text"]),
                "category": category if isinstance(category, str) and category else "practice"}
        for name, item, source_path in [("baseline", left, baseline_path), ("candidate", right, candidate_path)]:
            audio_path = (source_path.parent / item["file"]).resolve()
            try:
                reference_key = audio_path.relative_to(project_root).as_posix()
            except ValueError:
                reference_key = audio_path.as_posix()
            reference = reference_lookup.get(reference_key)
            if reference is None and reference_hashes:
                # Portable example copies and local training outputs retain
                # identical bytes. Match their actual digest, never text alone.
                digest = hashlib.sha256(audio_path.read_bytes()).hexdigest()
                reference = reference_hashes.get((digest, left["text"]))
            source_reference = None
            if isinstance(reference, dict) and reference.get("text") == left["text"] and isinstance(reference.get("words"), list):
                source_reference = {"url": local_url(audio_path, output), "text": reference["text"],
                                    "words": reference["words"]}
            pair[name] = {
                "audio": local_url(audio_path, output),
                "reference": source_reference,
                "duration_seconds": item.get("duration_seconds"),
                "generation_seconds": item.get("generation_seconds"),
                "may_be_truncated": bool(item.get("may_be_truncated")),
                "samples_above_unit_amplitude": item.get("samples_above_unit_amplitude", 0),
                "seed": item.get("seed")
            }
        pairs.append(pair)

    payload = {
        "schema_version": 1, "built_at_utc": datetime.now(timezone.utc).isoformat(),
        "baseline_metadata": provenance_reference(baseline_path, output, project_root),
        "candidate_metadata": provenance_reference(candidate_path, output, project_root),
        "training_result": provenance_reference(result_path, output, project_root),
        "phonetics_data": provenance_reference(phonetics_data, output, project_root) if phonetics_data and phonetics_data.is_file() else None,
        "reference_data": provenance_reference(reference_data, output, project_root) if reference_data and reference_data.is_file() else None,
        "model": public_label(candidate.get("model")) or "Qwen3-TTS",
        "candidate_adapter": public_label(candidate.get("adapter")),
        "baseline_adapter": public_label(baseline.get("adapter")),
        "settings_differences": differences,
        "training": {key: training.get(key) for key in [
            "status", "optimizer_steps", "trainable_parameters", "validation_ce_before",
            "validation_ce_best", "best_step", "weights_changed", "adapter_sha256_before",
            "adapter_sha256_after", "elapsed_seconds", "naturalness_improved",
            "human_listening_evaluation", "app_integrated", "suggested_adapter"
        ]},
        "pairs": pairs
    }
    data = json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c").replace("&", "\\u0026")
    steps = training.get("optimizer_steps")
    steps_text = str(steps) if isinstance(steps, int) else "ไม่ได้บันทึก"
    changed = "เปลี่ยนแล้ว" if training.get("weights_changed") is True else (
        "ยังไม่เปลี่ยน" if training.get("weights_changed") is False else "ไม่ได้บันทึก")
    ce_text = f"{number_text(training.get('validation_ce_before'))} → {number_text(training.get('validation_ce_best'))}"
    template = r'''<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ฝึกออกเสียงทีละประโยค — English Garden Lab</title>
<link rel="stylesheet" href="__PHONETICS_CSS__">
<style>
:root{color-scheme:light;--ink:#17392c;--muted:#607167;--line:#d9e3d7;--paper:#f5f7f1;--white:#fff;--accent:#24593d}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}button,input,select{font:inherit}button{cursor:pointer}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid #b88639;outline-offset:3px}a{color:var(--accent)}
.page{max-width:1280px;margin:auto;padding:28px 28px 24px}.page-header{display:flex;align-items:start;justify-content:space-between;gap:20px}.eyebrow{margin:0 0 5px;font-size:11px;letter-spacing:.13em;font-weight:750;color:var(--muted)}h1{font-size:clamp(26px,3vw,36px);line-height:1.35;letter-spacing:-.03em;margin:0;font-weight:650}.intro{margin:8px 0 0;color:var(--muted);font-size:14px;max-width:700px}.pill{display:inline-block;padding:5px 11px;font-size:11px;border:1px solid #cbdcc9;border-radius:20px;background:#eaf2e6;white-space:nowrap}
.steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));list-style:none;padding:0;margin:22px 0 18px;gap:14px}.steps li{display:flex;align-items:center;gap:10px;font-size:13px}.steps strong{display:grid;place-items:center;background:#e3eddd;border:1px solid #d0dfc8;width:29px;height:29px;border-radius:50%;flex-shrink:0;font-size:12px}.steps span{color:var(--muted)}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;margin:0 0 17px}.toolbar p{margin:0;font-size:12px;color:var(--muted)}.actions{display:flex;gap:8px;flex-wrap:wrap}.action{font-size:12px;line-height:1.4;font-weight:650;padding:10px 13px;border:1px solid var(--accent);border-radius:8px;background:var(--accent);color:#fff}.action.secondary{background:transparent;border-color:#bacdb7;color:var(--ink)}
.workspace{display:grid;grid-template-columns:260px minmax(0,1fr);gap:23px;align-items:start}.phrase-sidebar{position:sticky;top:20px;padding:18px 14px;background:#edf2e8;border:1px solid var(--line);border-radius:15px;min-width:0}.sidebar-title{font-size:15px;margin:0 0 12px}.filter-label{font-size:11px;color:var(--muted);display:block;margin:10px 0 4px}.filter-field{width:100%;min-width:0;padding:9px 10px;border:1px solid #c5d5bd;border-radius:8px;background:white;color:var(--ink);font-size:13px;line-height:1.5}.filter-count{font-size:10px;color:var(--muted);margin:11px 0 8px}.phrase-list{display:flex;flex-direction:column;gap:5px;max-height:calc(100vh - 310px);min-height:180px;overflow:auto;padding:1px 3px 1px 0}.phrase-option{width:100%;text-align:left;border:1px solid transparent;border-radius:9px;padding:10px;background:transparent;color:var(--ink);line-height:1.4}.phrase-option:hover{background:#e2ecdb}.phrase-option[aria-current=true]{background:white;border-color:#b7cdac;box-shadow:0 1px 3px #17392c09}.phrase-option .list-meta{display:flex;justify-content:space-between;gap:8px;color:var(--muted);font-size:10px;margin-bottom:4px}.list-text{font-size:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.list-done{color:#356d3f;font-weight:750}.list-empty{font-size:12px;color:var(--muted);padding:10px 6px}
.practice{min-width:0}.phrase-navigation{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:1px 0 13px}.phrase-counter{font-size:12px;color:var(--muted);margin:0}.nav-buttons{display:flex;gap:7px}.nav-button{font-size:11px;border:1px solid #bfceba;border-radius:7px;padding:7px 11px;background:#fff;color:var(--ink)}.current-phrase{min-width:0}.phrase-card{padding:24px;background:var(--white);border:1px solid var(--line);border-radius:15px}.phrase-category{font-size:11px;color:var(--muted);margin:0 0 9px}.phrase-text{margin:0 0 20px;font:500 clamp(23px,2.5vw,31px)/1.5 Georgia,"Times New Roman",serif;letter-spacing:-.025em;overflow-wrap:anywhere}.voice-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.voice{padding:13px;border:1px solid #dfe7da;border-radius:11px;background:#f8faf5;min-width:0}.voice-label{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:750;margin-bottom:10px}.identity{font-size:10px;color:var(--muted);font-weight:500}.voice audio{width:100%;height:38px;display:block}.warning{font-size:11px;color:#86562c;margin:7px 0 0}.listen-ratings{margin-top:15px;border-top:1px solid #e2e9dd;padding-top:11px}.listen-ratings summary{font-size:12px;color:var(--muted);cursor:pointer}.rating-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.rating-field{border:0;padding:0;margin:13px 0 0;min-width:0}.rating-field legend{font-size:11px;font-weight:600;margin-bottom:6px}.choices{display:flex;gap:6px;flex-wrap:wrap}.choice{position:relative;display:inline-flex;cursor:pointer}.choice input{position:absolute;opacity:0;pointer-events:none}.choice span{border:1px solid #ccd9c6;background:white;border-radius:6px;min-width:31px;padding:4px 9px;text-align:center;font-size:12px}.choice input:checked+span{background:#e3efdd;border-color:#6c9869;color:#214c2d;font-weight:700}.choice input:focus-visible+span{outline:3px solid #b88639;outline-offset:2px}.rating-help{font-size:10px;color:var(--muted);margin:7px 0}.phonetic-panel{margin-top:18px}.empty-workspace{background:white;border:1px dashed #c7d6c0;border-radius:15px;padding:50px 24px;text-align:center}.empty-workspace h2{margin:0 0 8px;font-size:21px}.empty-workspace p{font-size:13px;color:var(--muted);margin:0 0 18px}
.privacy{font-size:11px;color:var(--muted);margin:18px 0}.notice{font-size:12px;color:#805425;margin:8px 0}.footer{border-top:1px solid var(--line);padding-top:14px;margin-top:22px;font-size:11px;color:var(--muted)}.footer p{margin:4px 0}.experiment{margin:13px 0}.experiment summary{cursor:pointer;font-weight:650;font-size:12px;color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;margin:14px 0}.metric{border-left:3px solid #bdd0b5;padding-left:11px}.metric span{font-size:10px;display:block}.metric strong{font-size:15px;font-weight:600;color:var(--ink)}#technical{white-space:pre-wrap;overflow-wrap:anywhere;font-size:10px;line-height:1.6}
.phrase-translation{margin:-8px 0 13px;font-size:17px;line-height:1.7;color:#31583d}.study-tip{font-size:12px;color:var(--muted);margin:0 0 15px}.study-chunks{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 17px}.study-chunk{padding:8px 11px;border:1px solid #c6d8bc;border-radius:8px;background:#f0f6e9;color:var(--ink);text-align:left}.study-chunk span{display:block;font-size:13px;font-weight:600}.study-chunk small{display:block;font-size:10px;font-weight:400;color:var(--muted);margin-top:2px}.example-controls{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px}.slow-choice{font-size:12px;color:var(--muted);display:flex;align-items:center;gap:6px}.slow-choice input{accent-color:var(--accent)}.example-status{font-size:11px;color:var(--muted);margin:7px 0 0}.chunk-label{font-size:11px;color:var(--muted);margin:12px 0 0}
.list-translation{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--muted);font-size:11px;margin-top:4px}
@media(max-width:930px){.workspace{grid-template-columns:210px minmax(0,1fr);gap:16px}.page{padding:24px 18px}.phrase-card{padding:19px}.steps li{font-size:12px}.identity{font-size:9px}}
@media(max-width:720px){.page-header{display:block}.page-header .pill{margin-top:12px}.workspace{grid-template-columns:1fr}.phrase-sidebar{position:static;padding:14px}.sidebar-title{margin-bottom:6px}.phrase-list{max-height:180px;min-height:0}.steps{gap:8px}.steps li{align-items:start;font-size:11px;gap:7px}.steps strong{width:25px;height:25px}.voice-grid{gap:10px}.toolbar{align-items:start;flex-wrap:wrap}.phrase-card{padding:18px}.phrase-text{font-size:25px}.metrics{grid-template-columns:1fr;gap:10px}}
@media(max-width:420px){.page{padding:20px 13px}.steps{grid-template-columns:1fr;gap:8px;margin:16px 0}.steps li{align-items:center;font-size:12px}.voice-grid,.rating-grid{grid-template-columns:1fr}.voice-label{margin-bottom:7px}.toolbar .actions{width:100%}.toolbar .action{flex:1}.phrase-navigation{gap:8px}.nav-button{padding:7px 9px}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style>
</head>
<body>
<main class="page">
<header class="page-header"><div><p class="eyebrow">ENGLISH GARDEN LAB / SPEAKING PRACTICE</p><h1>ฟังให้ชัด ฝึกทีละประโยค</h1><p class="intro">ฟังตัวอย่าง ดูคำและเสียงที่ตรงกัน แล้วลองพูดตาม เลือกฝึกทีละประโยคได้ตามจังหวะของคุณ</p></div><span class="pill">พื้นที่ทดลองฝึกออกเสียง</span></header>
<ol class="steps" aria-label="วิธีฝึกสามขั้น"><li><strong>1</strong><span>เลือกประโยคที่อยากลอง</span></li><li><strong>2</strong><span>ฟังเสียง A และ B แล้วกดวิเคราะห์</span></li><li><strong>3</strong><span>ดูจุดที่ควรฝึก แล้วลองพูดเอง</span></li></ol>
<div class="toolbar"><p id="progress" role="status" aria-live="polite">ยังไม่ได้ให้คะแนนเสียงที่ฟัง</p><div class="actions"><button id="reveal" class="action secondary" type="button">เฉลยเสียง A / B</button><button id="export" class="action" type="button">บันทึกผล JSON</button></div></div>
<p class="notice" id="settings-warning" hidden></p>
<div class="workspace">
<aside class="phrase-sidebar" aria-label="เลือกประโยคฝึก"><h2 class="sidebar-title">ประโยคสำหรับฝึก</h2><label class="filter-label" for="phrase-search">ค้นหาประโยคอังกฤษหรือความหมายไทย</label><input class="filter-field" id="phrase-search" type="search" placeholder="เช่น ใบไม้ หรือ leaf" autocomplete="off"><label class="filter-label" for="phrase-category">เลือกเรื่อง</label><select class="filter-field" id="phrase-category"><option value="">ทุกเรื่อง</option></select><p class="filter-count" id="filter-count" role="status"></p><nav class="phrase-list" id="phrase-list" aria-label="รายการประโยค"></nav></aside>
<section class="practice" aria-label="พื้นที่ฝึกประโยคที่เลือก"><div class="phrase-navigation"><p class="phrase-counter" id="phrase-counter" aria-live="polite"></p><div class="nav-buttons"><button type="button" id="previous" class="nav-button">← ก่อนหน้า</button><button type="button" id="next" class="nav-button">ถัดไป →</button></div></div><div class="current-phrase" id="current-phrase"></div></section>
</div>
<p class="privacy">ผลฟังและคะแนนอยู่ในหน้านี้ บันทึก JSON เพื่อเก็บไว้ก่อนปิดหรือรีเฟรช เสียงที่บันทึกใช้ฟังซ้ำได้ กดดูผลจึงเริ่มวิเคราะห์ เดโมเว็บประมวลผลเสียงในเบราว์เซอร์และดาวน์โหลดโมเดลประมาณ 318 MB ในครั้งแรก ไม่มีการส่งเสียงไปบริการคลาวด์</p>
<footer class="footer"><details class="experiment" id="experiment"><summary>รายละเอียดการทดลองเสียง</summary><div class="metrics" aria-label="ผลฝึกที่บันทึกจริง"><div class="metric"><span>ขั้นตอนปรับน้ำหนัก</span><strong>__STEPS__ steps</strong></div><div class="metric"><span>Validation token loss · ก่อน → ค่าดีสุด</span><strong>__CE__</strong></div><div class="metric"><span>น้ำหนัก adapter</span><strong>__CHANGED__</strong></div></div><p>ค่า loss วัดการทำนาย token เสียง ยังสรุปไม่ได้ว่าฟังเป็นธรรมชาติขึ้น คุณภาพการฟังต้องประเมินแยก ตัวอย่างเสียงที่ฝึกยังไม่ได้เชื่อมเข้าแอปเรียน</p><div id="technical">กดเฉลยเสียง A / B เพื่อดูรุ่นที่ใช้ในรอบนี้</div></details><p>เสียงฝึก: <strong>Cori Samuel (speaker 92)</strong> จาก Hi-Fi TTS โดย E. Bakhturina, V. Lavrukhin, B. Ginsburg และ Y. Zhang (2021) · <a href="https://www.openslr.org/109/" target="_blank" rel="noopener noreferrer">แหล่งข้อมูล</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a></p><p>คัดข้อมูลบางส่วน แปลงเป็น 24 kHz และใช้ปรับ adapter</p></footer>
</main>
<script id="trial-data" type="application/json">__DATA__</script>
<script src="__PHONE_GUIDE_JS__"></script>
<script src="__SOUND_FOUNDATIONS_JS__"></script>
<script src="__VOWEL_PAIRS_JS__"></script>
<script src="__VOWEL_AUDIO_JS__"></script>
<script src="__PRONUNCIATION_VIDEOS_JS__"></script>
<script src="__ARTICULATION_IMAGES_JS__"></script>
<script src="__STUDY_HELP_JS__"></script>
<script src="__BROWSER_PHONETICS_JS__"></script>
<script src="__SPELLING_GUIDE_JS__"></script>
<script src="__SPELLING_FEEDBACK_JS__"></script>
<script src="__WORD_AUDIO_JS__"></script>
<script src="__PHONETICS_JS__"></script>
<script>
'use strict';
const data=JSON.parse(document.getElementById('trial-data').textContent);
const startedAt=new Date().toISOString();
const answers=new Map(),assignments=new Map();
const studyCache=new Map();
const categoryNames={greeting:'ทักทาย',garden:'สวนและต้นไม้',encouragement:'กำลังใจ',teaching:'สอนและทบทวน',conversation:'สนทนา',normalization:'ตัวเลขและคำย่อ',practice:'ทั่วไป'};
let revealedAt=null,selectedId=data.pairs.find(pair=>/^This is a leaf[.!?\s]/i.test(pair.text))?.id||data.pairs[0]?.id||null,currentCleanup=null,ratingsExpanded=false,stopPhrasePlayback=null,exampleRate=1;
const search=document.getElementById('phrase-search'),category=document.getElementById('phrase-category');
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function randomBit(){if(globalThis.crypto&&crypto.getRandomValues)return crypto.getRandomValues(new Uint8Array(1))[0]&1;return Math.random()<0.5?0:1;}
function complete(a){return Boolean(a.naturalness_A&&a.naturalness_B&&a.preference);}
function studyFor(text){if(studyCache.has(text))return studyCache.get(text);let help=null;try{help=window.EGLStudyHelp?.forText(text)||null;}catch{}studyCache.set(text,help);return help;}
function filteredPairs(){const term=search.value.trim().toLocaleLowerCase();return data.pairs.filter(pair=>{const help=studyFor(pair.text);const searchable=pair.text+' '+(categoryNames[pair.category]||pair.category)+' '+(help?.translation||'')+' '+Object.values(help?.words||{}).join(' ');return(!category.value||pair.category===category.value)&&(!term||searchable.toLocaleLowerCase().includes(term));});}
function updateProgress(){const count=Array.from(answers.values()).filter(complete).length;document.getElementById('progress').textContent=count?`ให้คะแนนครบ ${count} / ${data.pairs.length} ประโยค`:`ยังไม่ได้ให้คะแนนเสียงที่ฟัง · เลือกทำได้ ${data.pairs.length} ประโยค`;}
function answer(id,key,value){const a=answers.get(id);a[key]=value;a.updated_at=new Date().toISOString();a.last_rating_after_reveal=Boolean(revealedAt);if(!a.first_rating_at){a.first_rating_at=a.updated_at;a.first_rating_after_reveal=Boolean(revealedAt);}updateProgress();renderList();}
function options(group,label,items,selected,onChange){const field=el('fieldset','rating-field');field.append(el('legend','',label));const choices=el('div','choices');for(const [value,text]of items){const choice=el('label','choice'),radio=el('input');radio.type='radio';radio.name=group;radio.value=value;radio.checked=String(selected)===value;radio.addEventListener('change',()=>{if(radio.checked)onChange(value);});choice.append(radio,el('span','',text));choices.append(choice);}field.append(choices);return field;}
function stopExample(){const stop=stopPhrasePlayback;stopPhrasePlayback=null;if(typeof stop==='function')stop();}
function cleanupCurrent(){stopExample();const cleanup=currentCleanup;currentCleanup=null;if(typeof cleanup==='function'){try{cleanup();}catch{}}document.querySelectorAll('#current-phrase audio').forEach(player=>{try{player.pause();player.removeAttribute('src');player.load();}catch{}});}
function playExample(player,range,repeats,status){stopExample();document.querySelectorAll('audio').forEach(other=>{if(other!==player)other.pause();});let stopped=false,remaining=repeats||1;function stop(){if(stopped)return;stopped=true;player.pause();player.removeEventListener('loadedmetadata',begin);player.removeEventListener('timeupdate',time);player.removeEventListener('ended',end);}function finish(){if(stopped)return;if(remaining>1){remaining--;begin();}else{stop();stopPhrasePlayback=null;status.textContent='ฟังจบแล้ว แตะวลีหรือฟังซ้ำได้';}}function time(){if(range&&player.currentTime>=range.end)finish();}function end(){finish();}function begin(){if(stopped)return;try{player.currentTime=range?range.start:0;player.playbackRate=exampleRate;const result=player.play();if(result&&typeof result.catch==='function')result.catch(()=>{if(!stopped)status.textContent='กดเล่นที่เครื่องเล่นเสียง แล้วลองอีกครั้ง';});}catch{status.textContent='ยังเริ่มช่วงเสียงไม่ได้ ลองกดเล่นตัวอย่างก่อน';}}stopPhrasePlayback=stop;player.addEventListener('timeupdate',time);player.addEventListener('ended',end);if(player.readyState>=1)begin();else{player.addEventListener('loadedmetadata',begin,{once:true});player.load();}}
function chunkRange(reference,indices){if(!reference||!Array.isArray(reference.words)||!Array.isArray(indices)||!indices.length)return null;const words=indices.map(index=>reference.words.find((word,position)=>(Number.isInteger(word.index)?word.index:position)===index));if(words.some(word=>!word||!Number.isFinite(word.start)||!Number.isFinite(word.end)||word.start<0||word.end<=word.start))return null;return{start:Math.min(...words.map(word=>word.start)),end:Math.max(...words.map(word=>word.end))};}
function identityFor(id,label){return revealedAt?(assignments.get(id)[label]==='baseline'?'โมเดลเดิม':'รุ่นที่ปรับด้วยข้อมูลเสียง'):'ซ่อนชื่อรุ่นไว้ก่อน';}
function renderList(){const list=document.getElementById('phrase-list'),visible=filteredPairs();list.replaceChildren();document.getElementById('filter-count').textContent=`${visible.length} จาก ${data.pairs.length} ประโยค`;if(!visible.length){list.append(el('p','list-empty','ไม่พบประโยคที่ค้นหา'));return;}for(const pair of visible){const button=el('button','phrase-option');button.type='button';button.dataset.promptId=pair.id;button.setAttribute('aria-current',String(pair.id===selectedId));const meta=el('span','list-meta');meta.append(el('span','',categoryNames[pair.category]||pair.category));if(complete(answers.get(pair.id))){const done=el('span','list-done','✓');done.setAttribute('aria-label','ให้คะแนนครบแล้ว');meta.append(done);}const text=el('span','list-text',pair.text);text.lang='en';button.append(meta,text);const help=studyFor(pair.text);if(help?.translation)button.append(el('span','list-translation',help.translation));button.addEventListener('click',()=>selectPhrase(pair.id,true));list.append(button);}}
function navigation(){const visible=filteredPairs(),position=visible.findIndex(pair=>pair.id===selectedId);document.getElementById('previous').disabled=position<=0;document.getElementById('next').disabled=position<0||position>=visible.length-1;const globalIndex=data.pairs.findIndex(pair=>pair.id===selectedId);document.getElementById('phrase-counter').textContent=globalIndex<0?'ไม่มีประโยคที่เลือก':`ประโยค ${globalIndex+1} / ${data.pairs.length}`;}
function renderCurrent(focus=false){
 cleanupCurrent();const host=document.getElementById('current-phrase');host.replaceChildren();navigation();
 const pair=data.pairs.find(pair=>pair.id===selectedId);
 if(!pair){const empty=el('div','empty-workspace');empty.append(el('h2','','ยังไม่พบประโยคนี้'),el('p','','ลองเปลี่ยนคำค้นหรือเลือกเรื่องอื่น'));const clear=el('button','action secondary','แสดงทุกประโยค');clear.type='button';clear.addEventListener('click',()=>{search.value='';category.value='';applyFilters();});empty.append(clear);host.append(empty);return;}
 const exampleSource=pair[assignments.get(pair.id).A];
 const exampleReference={...(exampleSource.reference||{url:exampleSource.audio,text:pair.text,words:[]}),label:'เสียงตัวอย่าง A'};
 const study=studyFor(pair.text);
 const card=el('article','phrase-card');card.dataset.promptId=pair.id;card.append(el('p','phrase-category',categoryNames[pair.category]||pair.category));
 const heading=el('h2','phrase-text',pair.text);heading.lang='en';heading.tabIndex=-1;card.append(heading);
 if(study&&study.translation)card.append(el('p','phrase-translation',study.translation));
 if(study&&study.tip)card.append(el('p','study-tip',study.tip));
 const voices=el('div','voice-grid');
 for(const label of['A','B']){
   const source=pair[assignments.get(pair.id)[label]],voice=el('section','voice');voice.setAttribute('aria-label',`ตัวอย่างเสียง ${label}`);
   const row=el('div','voice-label');row.append(el('span','',`เสียง ${label}`));const identity=el('span','identity',identityFor(pair.id,label));identity.dataset.label=label;identity.dataset.id=pair.id;row.append(identity);voice.append(row);
   const player=el('audio');player.controls=true;player.preload='none';player.src=source.audio;player.dataset.voice=label;player.playbackRate=exampleRate;player.setAttribute('aria-label',`${pair.id} เสียง ${label}`);
   player.addEventListener('play',()=>{answers.get(pair.id)[`listened_${label}`]=true;document.querySelectorAll('audio').forEach(other=>{if(other!==player)other.pause();});});player.addEventListener('ended',()=>{answers.get(pair.id)[`completed_${label}`]=true;});voice.append(player);
   if(source.may_be_truncated)voice.append(el('p','warning','อาจมีเสียงไม่จบประโยค โปรดฟังตรวจ'));if(source.samples_above_unit_amplitude>0)voice.append(el('p','warning','โปรดฟังตรวจเสียงแตก'));voices.append(voice);
 }
 card.append(voices);const examplePlayer=voices.querySelector('[data-voice="A"]');
 const exampleStatus=el('p','example-status','กดเล่นเมื่อพร้อม ฟังช้าหรือฟังซ้ำได้');exampleStatus.setAttribute('role','status');
 const helperControls=el('div','example-controls'),slowLabel=el('label','slow-choice'),slow=el('input');slow.type='checkbox';slow.id='example-slow';slow.checked=exampleRate<1;slow.addEventListener('change',()=>{exampleRate=slow.checked ? 0.75 : 1;voices.querySelectorAll('audio').forEach(player=>{player.playbackRate=exampleRate;});});slowLabel.append(slow,el('span','','ฟังช้า'));
 const repeat=el('button','nav-button','ฟัง A ซ้ำ 2 รอบ');repeat.type='button';repeat.id='repeat-example';repeat.addEventListener('click',()=>{exampleStatus.textContent='กำลังฟังตัวอย่าง A ซ้ำ 2 รอบ';playExample(examplePlayer,null,2,exampleStatus);});helperControls.append(slowLabel,repeat);card.append(helperControls,exampleStatus);
 if(study&&Array.isArray(study.chunks)&&study.chunks.length){card.append(el('p','chunk-label','แตะวลีเพื่อฟังทีละช่วงจากเสียง A'));const chunks=el('div','study-chunks');for(const chunk of study.chunks){const button=el('button','study-chunk');button.type='button';const text=el('span','',chunk.text);text.lang='en';button.append(text);if(chunk.translation)button.append(el('small','',chunk.translation));button.addEventListener('click',()=>{const range=chunkRange(exampleReference,chunk.wordIndices);exampleStatus.textContent=range?'กำลังฟังวลีตัวอย่าง':'ยังไม่มีช่วงเสียงของวลีนี้ กำลังเล่นตัวอย่างเต็มประโยค';playExample(examplePlayer,range,1,exampleStatus);});chunks.append(button);}card.append(chunks);}
 const ratings=el('details','listen-ratings');ratings.open=ratingsExpanded;ratings.addEventListener('toggle',()=>{ratingsExpanded=ratings.open;});ratings.append(el('summary','','ให้คะแนนว่าเสียงไหนฟังเป็นธรรมชาติ (เลือกทำ)'));const ratingGrid=el('div','rating-grid'),saved=answers.get(pair.id);
 for(const label of['A','B'])ratingGrid.append(options(`${pair.id}-${label}`,`ความเป็นธรรมชาติ · เสียง ${label}`,[1,2,3,4,5].map(n=>[String(n),String(n)]),saved[`naturalness_${label}`],value=>answer(pair.id,`naturalness_${label}`,Number(value))));
 ratings.append(ratingGrid,el('p','rating-help','1 = แข็งหรือจังหวะแปลก · 5 = เป็นธรรมชาติ ฟังสบาย'),options(`${pair.id}-preference`,'เมื่อฟังครบ ชอบเสียงไหนมากกว่า?',[['A','A'],['equal','พอ ๆ กัน'],['B','B']],saved.preference,value=>answer(pair.id,'preference',value)));card.append(ratings);host.append(card);
 const phoneticContainer=el('section','phonetic-panel');phoneticContainer.setAttribute('aria-label','เทียบเสียงและฝึกออกเสียง');host.append(phoneticContainer);
 if(typeof window.EGLPhonetics?.mount==='function'){try{const audioSources=['A','B'].map(label=>{const source=pair[assignments.get(pair.id)[label]];return {label,url:source.audio,text:pair.text,words:source.reference?.words||[]};});const cleanup=window.EGLPhonetics.mount(phoneticContainer,{text:pair.text,audioSources,apiBase:'http://127.0.0.1:8766',precomputed:pair.precomputed||null,referenceExample:exampleReference,expanded:true});if(typeof cleanup==='function')currentCleanup=cleanup;}catch{phoneticContainer.textContent='เครื่องมือแยกเสียงยังไม่พร้อม ฟังตัวอย่าง A / B และเลือกประโยคต่อไปได้';}}else{phoneticContainer.textContent='เครื่องมือแยกเสียงยังไม่พร้อม ลองเปิดผ่านบริการเสียงในเครื่อง';}
 if(focus)heading.focus({preventScroll:true});
}
function selectPhrase(id,focus=false){if(!filteredPairs().some(pair=>pair.id===id))return;if(selectedId!==id){selectedId=id;renderCurrent(focus);}renderList();navigation();}
function applyFilters(){const visible=filteredPairs(),next=visible.some(pair=>pair.id===selectedId)?selectedId:(visible[0]?.id||null);if(next!==selectedId){selectedId=next;renderCurrent();}else navigation();renderList();}
for(const pair of data.pairs){const order=randomBit()?['candidate','baseline']:['baseline','candidate'];assignments.set(pair.id,{A:order[0],B:order[1]});answers.set(pair.id,{id:pair.id,naturalness_A:null,naturalness_B:null,preference:null,listened_A:false,listened_B:false,completed_A:false,completed_B:false});}
for(const value of new Set(data.pairs.map(pair=>pair.category))){const option=el('option','',categoryNames[value]||value);option.value=value;category.append(option);}
search.addEventListener('input',applyFilters);category.addEventListener('change',applyFilters);
document.getElementById('previous').addEventListener('click',()=>{const visible=filteredPairs(),index=visible.findIndex(pair=>pair.id===selectedId);if(index>0)selectPhrase(visible[index-1].id,true);});
document.getElementById('next').addEventListener('click',()=>{const visible=filteredPairs(),index=visible.findIndex(pair=>pair.id===selectedId);if(index>=0&&index<visible.length-1)selectPhrase(visible[index+1].id,true);});
if(data.settings_differences.length){const warning=document.getElementById('settings-warning');warning.hidden=false;warning.textContent='ตัวอย่างสองเสียงใช้การตั้งค่าบางอย่างต่างกัน จึงอาจได้ยินความต่างจากหลายปัจจัย';}
document.getElementById('reveal').addEventListener('click',()=>{if(revealedAt)return;revealedAt=new Date().toISOString();document.querySelectorAll('.identity').forEach(node=>{node.textContent=identityFor(node.dataset.id,node.dataset.label);});const adapter=data.candidate_adapter?String(data.candidate_adapter).split('/').pop():'ไม่มี adapter';document.getElementById('technical').textContent=JSON.stringify({candidate_adapter:adapter,baseline_adapter:data.baseline_adapter,model:data.model,training:data.training,baseline_metadata:data.baseline_metadata,candidate_metadata:data.candidate_metadata,settings_differences:data.settings_differences},null,2);const button=document.getElementById('reveal');button.textContent='เฉลยแล้ว';button.disabled=true;});
document.getElementById('export').addEventListener('click',()=>{const ratings=data.pairs.map(pair=>({...answers.get(pair.id),text:pair.text,assignment:assignments.get(pair.id)}));const result={schema_version:1,purpose:'single_listener_local_tts_ab_evaluation',session_started_at_utc:startedAt,exported_at_utc:new Date().toISOString(),revealed_at_utc:revealedAt,quality_claim:'Listener ratings only; no general naturalness improvement established.',app_integrated:false,baseline_metadata:data.baseline_metadata,candidate_metadata:data.candidate_metadata,candidate_adapter:data.candidate_adapter,training_result:data.training_result,settings_differences:data.settings_differences,selected_prompt_id:selectedId,filters:{search:search.value,category:category.value},ratings};const blob=new Blob([JSON.stringify(result,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob),link=el('a');link.href=url;link.download='english-garden-voice-ratings-'+new Date().toISOString().replaceAll(':','-').slice(0,19)+'.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('pagehide',cleanupCurrent);window.addEventListener('pageshow',event=>{if(event.persisted)renderCurrent();});
renderList();renderCurrent();updateProgress();
</script>
</body></html>
'''
    return (template.replace("__STEPS__", html.escape(steps_text))
            .replace("__CE__", html.escape(ce_text))
            .replace("__CHANGED__", html.escape(changed))
            .replace("__DATA__", data)
            .replace("__PHONETICS_CSS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/phonetics.css", output), quote=True))
            .replace("__PHONE_GUIDE_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/phone-guide.js", output), quote=True))
            .replace("__SOUND_FOUNDATIONS_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/sound-foundations.js", output), quote=True))
            .replace("__VOWEL_PAIRS_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/vowel-pairs.js", output), quote=True))
            .replace("__VOWEL_AUDIO_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/vowel-audio.js", output), quote=True))
            .replace("__PRONUNCIATION_VIDEOS_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/pronunciation-videos.js", output), quote=True))
            .replace("__ARTICULATION_IMAGES_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/articulation-images.js", output), quote=True))
            .replace("__STUDY_HELP_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/study-help.js", output), quote=True))
            .replace("__BROWSER_PHONETICS_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/browser-phonetics.js", output), quote=True))
            .replace("__SPELLING_GUIDE_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/spelling-guide.js", output), quote=True))
            .replace("__SPELLING_FEEDBACK_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/spelling-feedback.js", output), quote=True))
            .replace("__WORD_AUDIO_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/word-audio.js", output), quote=True))
            .replace("__PHONETICS_JS__", html.escape(local_url(Path(__file__).resolve().parent.parent / "app/phonetics.js", output), quote=True)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True, help="Synthesis metadata.json or its directory")
    parser.add_argument("--candidate", type=Path, required=True, help="Synthesis metadata.json or its directory")
    parser.add_argument("--training-result", type=Path, required=True)
    parser.add_argument("--phonetics-data", type=Path,
                        default=Path(__file__).resolve().parent / "resources/phonetics.json",
                        help="Optional precomputed text-to-IPA mapping; no HTTP lookup occurs while building")
    parser.add_argument("--reference-data", type=Path,
                        default=Path(__file__).resolve().parent / "resources/reference-audio.json",
                        help="Optional word timings for replaying words and short phrases from actual example audio")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "listen.html")
    args = parser.parse_args()
    try:
        output = args.output.resolve()
        page = build(metadata_path(args.baseline), metadata_path(args.candidate), args.training_result.resolve(), output,
                     args.phonetics_data.resolve() if args.phonetics_data else None,
                     args.reference_data.resolve() if args.reference_data else None)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(page, encoding="utf-8")
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    print(f"Created {output}")


if __name__ == "__main__":
    main()
