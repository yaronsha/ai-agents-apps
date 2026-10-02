# Guitar Tabber

Convert an MP3/MP4 of a **full song** (guitar + other instruments + vocals) into
**ASCII guitar tablature**.

Pipeline:

1. **Extract** audio with `ffmpeg` (mono WAV)
2. **Separate** a guitar stem with **Demucs** (`htdemucs_6s` → dedicated `guitar` stem; falls back to `other` on 4-stem models)
3. **Detect** notes with **librosa.pyin** (monophonic pitch tracking + onsets)
4. **Map** MIDI pitches to a standard-tuning (EADGBE) fretboard (prefer lower frets)
5. **Emit** ASCII tablature to stdout and `<input>.tab.txt`

## System requirements

- Python 3.10+ (Linux Mint 21.x / Ubuntu 22.04 default of 3.10 works; macOS too)
- [ffmpeg](https://ffmpeg.org/) on `PATH`
  - Linux Mint/Ubuntu: `sudo apt install ffmpeg libsndfile1 python3-venv`
  - macOS: `brew install ffmpeg`
- ~2–4 GB disk for Demucs model weights (downloaded on first run)
- CPU is fine; CUDA optional via `--device cuda`

## Install

```bash
cd guitar-tabber
./setup.sh                 # creates .venv, installs torch + requirements
source .venv/bin/activate
```

Manual equivalent:

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip setuptools wheel
# Linux without GPU (smaller CPU wheel); on macOS just `pip install torch torchaudio`
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

## Usage

```bash
# Full mix (runs Demucs guitar separation, then tab generation)
python -m guitar_tabber path/to/song.mp3
# or
python main.py path/to/song.mp4

# Already-isolated guitar track — skip Demucs
python -m guitar_tabber path/to/guitar_only.wav --skip-separation

# Keep the separated guitar stem next to the input
python -m guitar_tabber path/to/song.mp3 --keep-stems -v

# Choose Demucs model / device
python -m guitar_tabber song.mp3 --model htdemucs_6s --device cpu
```

Output example:

```
e|-----------|
B|-----------|
G|-----------|
D|-----------|
A|--0-----0--|
E|-----------|
```

A `.tab.txt` file is also written beside the input (or to `-o`).

## Synthetic end-to-end test (no real guitar file needed)

```bash
source .venv/bin/activate
python tests/generate_test_audio.py

# Isolated open-A tone (~110 Hz) — should map near open A string (A0)
python -m guitar_tabber tests/fixtures/open_a.wav --skip-separation -v

# Mixed synthetic “song” (guitar + bass + noise + fake vocal)
# First run downloads Demucs weights (can take several minutes)
python -m guitar_tabber tests/fixtures/mixed_demo.mp3 --keep-stems -v
```

## Honest limitations

| Area | Reality |
|------|---------|
| **Stem separation** | Demucs quality varies by mix. Guitar often bleeds into `other`/`vocals`; drums/bass can leak into the guitar stem. `htdemucs_6s` helps but is not perfect. |
| **Monophonic detection** | Pitch tracking uses `librosa.pyin` — best for **single-note** lines. Chords / fingerpicking polyphony are not reliably transcribed; multi-pitch is only lightly attempted via near-simultaneous grouping. |
| **Recording quality** | Distortion, heavy FX, room noise, and low bitrate hurt accuracy. Clean DI or close-mic acoustic works better than a phone recording of a live band. |
| **Electric vs acoustic** | Both are accepted, but noise floors and timbre differ; aggressive amp gain confuses pitch trackers. |
| **Expression** | Bends, slides, vibrato, harmonics, palm mutes, and whammy tricks are **not** notated — you get fretted pitch snapshots. |
| **Tuning** | Assumes **standard EADGBE** at A=440. Drop tunings / capos will map to wrong frets. |
| **Fret choice** | Ambiguous pitches prefer **lower frets / open strings**. Alternate positions (e.g. 5th-fret A vs open A) may not match the original fingering. |
| **Timing / rhythm** | Tab frames are one column per detected note, not strict rhythmic notation. No time signature or beat grid. |
| **Speed / resources** | Demucs on CPU is slow for long tracks. Prefer short clips while experimenting. |

## Project layout

```
guitar-tabber/
  main.py
  requirements.txt
  README.md
  guitar_tabber/
    __main__.py      # python -m guitar_tabber
    cli.py
    pipeline.py      # extract → separate → pitch → tab
    audio.py
    separation.py    # Demucs
    pitch.py         # librosa.pyin
    fretboard.py     # MIDI ↔ frets
    tab.py           # ASCII formatter
  tests/
    generate_test_audio.py
    fixtures/        # created by the generator
```

## License

Demo / research tool. Demucs and model weights are subject to their own licenses (Facebook Research / Meta Demucs).
