#!/usr/bin/env bash
# Create .venv and install dependencies. Works on Linux (Mint/Ubuntu) and macOS.
set -euo pipefail
cd "$(dirname "$0")"

PY="${PYTHON:-python3}"
"$PY" -c 'import sys; sys.exit(sys.version_info < (3, 10))' \
  || { echo "Python 3.10+ required (found $("$PY" --version))"; exit 1; }

if ! command -v ffmpeg >/dev/null; then
  case "$(uname -s)" in
    Darwin) echo "ffmpeg missing: brew install ffmpeg" ;;
    *)      echo "ffmpeg missing: sudo apt install ffmpeg libsndfile1 python3-venv" ;;
  esac
  exit 1
fi

[ -d .venv ] || "$PY" -m venv .venv \
  || { echo "venv failed; on Mint/Ubuntu: sudo apt install python3-venv"; exit 1; }
# shellcheck disable=SC1091
source .venv/bin/activate
pip install --upgrade pip setuptools wheel

if [ "$(uname -s)" = "Linux" ] && ! command -v nvidia-smi >/dev/null; then
  pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
else
  pip install torch torchaudio   # macOS (CPU/MPS) or Linux with NVIDIA GPU
fi
pip install -r requirements.txt
echo "Done. Run: source .venv/bin/activate && python main.py song.mp3"
