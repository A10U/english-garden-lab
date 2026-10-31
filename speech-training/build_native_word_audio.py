"""Verify only the explicitly attributed public human-word assets for export."""
import hashlib
import json
from pathlib import Path
import re
import urllib.parse
from export_demo_assets import assert_public, wav_info


def verified_files(root: Path) -> dict[str, bytes]:
    directory = root / "app/assets/native-words"
    manifest_path = directory / "ATTRIBUTION.json"
    if not manifest_path.is_file():
        return {}
    manifest = json.loads(manifest_path.read_text())
    assert_public(manifest, "public native-word reference metadata")
    if manifest.get("schema_version") not in {1, 2} or manifest.get("accent") != "en-us" or not isinstance(manifest.get("words"), list):
        raise ValueError("Invalid native-word attribution manifest")
    result = {}
    for row in manifest["words"]:
        if row.get("available") is not True: continue
        name = row.get("url", "")
        accent = row.get("accent", manifest["accent"])
        word = row.get("word", "")
        reference = row.get("reference", {})
        source = urllib.parse.unquote(str(row.get("source_page", "")))
        us = (accent == "en-us" and row.get("author") in {"Muke", "Dvortygirl"}
              and row.get("license") in {"Public domain", "CC BY-SA 3.0"}
              and source == "https://commons.wikimedia.org/wiki/File:En-us-" + word + ".ogg")
        uk = (accent == "en-gb" and row.get("author") == "Association Shtooka, Judith Franck"
              and row.get("license") == "CC BY 3.0 us"
              and row.get("license_url") == "https://creativecommons.org/licenses/by/3.0/us/"
              and row.get("speaker_region") == "London, England, according to the source file description"
              and source == "https://commons.wikimedia.org/wiki/File:En-uk-" + word + ".ogg")
        if (not re.fullmatch(r"assets/native-words/word-[a-f0-9]{20}\.wav", name)
            or not re.fullmatch(r"[a-z]+(?:'[a-z]+)?", word)
            or row.get("source_kind") != "human" or row.get("standalone") is not True
            or not (us or uk)):
            raise ValueError("Unverified native-word path, provenance or license")
        if (reference.get("text") != word or reference.get("accent") != accent
            or len(reference.get("words", [])) != 1 or not reference["words"][0].get("phones")):
            raise ValueError("Native-word accent/reference mismatch")
        path = root / "app" / name
        if not path.is_file() or path.is_symlink(): raise ValueError("Missing or symlinked native-word file")
        data = path.read_bytes(); metrics = wav_info(data)
        if len(data) != row.get("bytes") or hashlib.sha256(data).hexdigest() != row.get("sha256") or not .2 <= metrics["duration_seconds"] <= 8:
            raise ValueError("Native-word WAV failed integrity or duration verification")
        result["app/" + name] = data
    for name in ("ATTRIBUTION.json", "ATTRIBUTION.md", "CMUDICT-LICENSE.txt"):
        path = directory / name
        if not path.is_file() or path.is_symlink(): raise ValueError("Missing native-word credits/license")
        result["app/assets/native-words/" + name] = path.read_bytes()
    return result
