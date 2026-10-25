"""Retrieve the exact model revision used by this local training experiment."""
from pathlib import Path
import json

from huggingface_hub import snapshot_download


def main():
    root = Path(__file__).resolve().parent
    source = json.loads((root / "model-source.json").read_text())
    destination = root / "models/qwen3-tts-0.6b-base-8bit"
    snapshot_download(source["repo_id"], revision=source["revision"], local_dir=destination)
    print(destination)


if __name__ == "__main__":
    main()
