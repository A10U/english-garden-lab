#!/bin/bash
set -euo pipefail
PHONETICS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
echo 'Phonetic analyzer: http://127.0.0.1:8766/speech-training/listen.html'
echo 'English Garden Lab: http://127.0.0.1:8766/app/index.html'
exec "$PHONETICS_DIR/.venv/bin/python" "$PHONETICS_DIR/phonetic_server.py"
