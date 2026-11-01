"""Install a pinned official Praat build in the ignored project tools directory."""
from __future__ import annotations

import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

VERSION = "7.0.02"
URL = "https://github.com/praat/praat.github.io/releases/download/v7.0.02/praat7002_mac.dmg"
SHA256 = "9e4d1d220cff32ccfa4521114d23c11ebbfd792db61884f6019a44bd4aba19d4"
ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / ".build" / "acoustic-tools"
BINARY = TOOLS / "Praat.app" / "Contents" / "MacOS" / "Praat"


def version() -> str:
    return subprocess.run([str(BINARY), "--version"], check=True,
                          capture_output=True, text=True, timeout=15).stdout.strip()


def main() -> None:
    if sys.platform != "darwin":
        raise SystemExit("This setup installs the official macOS build. Configure a trusted local Praat executable on other systems.")
    TOOLS.mkdir(parents=True, exist_ok=True)
    if BINARY.is_file():
        result = version()
        if VERSION not in result:
            raise SystemExit("An existing Praat installation has a different version; it was left unchanged.")
        print(result)
        return
    archive = TOOLS / "praat7002_mac.dmg"
    if not archive.is_file() or hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        partial = archive.with_suffix(".partial")
        try:
            request = urllib.request.Request(URL, headers={"User-Agent": "EnglishGarden-Acoustics-Setup"})
            with urllib.request.urlopen(request, timeout=60) as response, partial.open("wb") as output:
                shutil.copyfileobj(response, output)
            if hashlib.sha256(partial.read_bytes()).hexdigest() != SHA256:
                raise RuntimeError("The official download did not match the pinned SHA256.")
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    mount = TOOLS / "mount"
    mount.mkdir(exist_ok=True)
    target = TOOLS / "Praat.app"
    if target.exists():
        raise SystemExit("The target app directory already exists and was left unchanged.")
    subprocess.run(["hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", str(mount), str(archive)],
                   check=True, capture_output=True, timeout=60)
    try:
        source = mount / "Praat.app"
        if not source.is_dir():
            raise RuntimeError("The official disk image has no expected Praat.app bundle.")
        subprocess.run(["codesign", "--verify", "--deep", "--strict", str(source)],
                       check=True, capture_output=True, timeout=30)
        shutil.copytree(source, target, symlinks=True)
    finally:
        subprocess.run(["hdiutil", "detach", str(mount)], check=True, capture_output=True, timeout=30)
    result = version()
    if VERSION not in result:
        raise RuntimeError("The installed binary reported an unexpected version.")
    print(result)
    print("Official download checksum and app signature verified. Installed under .build/acoustic-tools only.")


if __name__ == "__main__":
    main()
