"""Download the pinned acoustic-phone checkpoint for the local analyzer."""
from pathlib import Path
import json
from huggingface_hub import snapshot_download


def main():
    root = Path(__file__).resolve().parent
    source = json.loads((root / "phonetic-model-source.json").read_text())
    output = root / "models/phoneme-ctc"
    snapshot_download(source["repo_id"], revision=source["revision"], local_dir=output)
    print(output)


if __name__ == '__main__':
    main()
