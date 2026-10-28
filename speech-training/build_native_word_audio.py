"""Verify only the explicitly attributed public human-word assets for export."""
import hashlib
import json
from pathlib import Path
import re
from export_demo_assets import assert_public, wav_info


def verified_files(root: Path) -> dict[str, bytes]:
    directory = root / "app/assets/native-words"
    manifest_path = directory / "ATTRIBUTION.json"
    if not manifest_path.is_file():
        return {}
    manifest = json.loads(manifest_path.read_text())
    assert_public(manifest, "public native-word reference metadata")
    if manifest.get("schema_version") != 1 or manifest.get("accent") != "en-us" or not isinstance(manifest.get("words"), list):
        raise ValueError("Invalid native-word attribution manifest")
    result = {}
    for row in manifest["words"]:
        if row.get("available") is not True: continue
        name = row.get("url", "")
        if (not re.fullmatch(r"assets/native-words/word-[a-f0-9]{20}\.wav", name)
            or row.get("source_kind") != "human" or row.get("license") not in {"Public domain", "CC BY-SA 3.0"}
            or row.get("author") not in {"Muke", "Dvortygirl"}
            or not str(row.get("source_page", "")).startswith("https://commons.wikimedia.org/wiki/File:")):
            raise ValueError("Unverified native-word path, provenance or license")
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
