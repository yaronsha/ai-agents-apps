# Guitar Tabber

Convert an MP3/MP4 of a **full song** (guitar + other instruments + vocals) into
**ASCII guitar tablature**, a structured **`.tab.json`** for the browser viewer,
and a **`.mid`** MIDI file.

Pipeline:

1. **Extract** audio with `ffmpeg` (mono WAV)
2. **Separate** a guitar stem with **Demucs** (`htdemucs_6s` → dedicated `guitar` stem; falls back to `other` on 4-stem models)
3. **Detect** notes with **librosa.pyin** (monophonic pitch tracking + onsets)
4. **Map** MIDI pitches to a standard-tuning (EADGBE) fretboard (prefer lower frets)
5. **Emit** ASCII tablature, `.tab.json`, and `.mid` beside the input

## System requirements

- Python 3.10+ (tested on 3.13)
- [ffmpeg](https://ffmpeg.org/) on `PATH` (`sudo apt install ffmpeg`)
- ~2–4 GB disk for Demucs model weights (downloaded on first run)
- CPU is fine; CUDA optional via `--device cuda`
- A modern browser for the tab viewer (no build step)

## Install

```bash
cd guitar-tabber
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
# PyTorch CPU wheels (recommended on machines without a GPU):
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

> **Note:** `librosa==1.0.0` does not exist on PyPI. Requirements pin
> `librosa>=0.10.2,<0.12` (e.g. 0.11.0).

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

# After export, print viewer instructions (and try to open the page)
python -m guitar_tabber path/to/song.mp3 --skip-separation --open-viewer
```

Each successful run writes three artifacts next to the input (or beside `-o`):

| File | Purpose |
|------|---------|
| `<stem>.tab.txt` | ASCII tablature + note log |
| `<stem>.tab.json` | Structured notes for the browser viewer |
| `<stem>.mid` | Standard MIDI (Type 0) of detected notes |

ASCII output example:

```
e|-----------|
B|-----------|
G|-----------|
D|-----------|
A|--0-----0--|
E|-----------|
```

### JSON schema (viewer)

```json
{
  "version": 1,
  "tuning": ["E", "A", "D", "G", "B", "e"],
  "notes": [
    {"t": 0.16, "dur": 0.74, "midi": 45, "string": 1, "fret": 0, "hz": 109.9}
  ]
}
```

`string` is `0` = low E … `5` = high e (same as `fretboard.py`).

## Browser tab viewer (Guitar Pro–style)

A self-contained viewer lives in `viewer/` — plain HTML/CSS/JS (Tone.js from CDN).
No npm build.

Features:

- Horizontal 6-string tab staff with readable fret numbers and scroll
- Play / pause / stop / seek / tempo
- Note playback synthesized from JSON (highlight stays in sync)
- Load via file picker, `?json=…` query, or embedded demo

### Open the demo (out of the box)

```bash
cd guitar-tabber/viewer
python -m http.server 8765
# open http://127.0.0.1:8765/
```

Or open `viewer/index.html` directly (`file://…`); the embedded demo still loads
if `fetch` of `demo.tab.json` is blocked.

### Open a tab you just generated

```bash
# 1) Run the pipeline
python -m guitar_tabber tests/fixtures/open_a.wav --skip-separation --open-viewer

# 2) Serve the viewer and either:
#    - use “Load .tab.json” in the UI, or
#    - copy/symlink the JSON into viewer/ and open:
#      http://127.0.0.1:8765/?json=open_a.tab.json
```

Shortcuts: `Space` play/pause · `←`/`→` seek · `Home` stop.

## Synthetic end-to-end test (no real guitar file needed)

```bash
source .venv/bin/activate
python tests/generate_test_audio.py

# Isolated open-A tone (~110 Hz) — should map near open A string (A0)
python -m guitar_tabber tests/fixtures/open_a.wav --skip-separation -v

# Mixed synthetic “song” (guitar + bass + noise + fake vocal)
# First run downloads Demucs weights (can take several minutes)
python -m guitar_tabber tests/fixtures/mixed_demo.mp3 --keep-stems -v

# Export unit tests (JSON + MIDI, no heavy audio stack beyond imports)
python tests/test_export.py
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
| **Viewer** | ASCII tabs with hundreds of notes are hard to read — use the browser viewer for playhead + highlight. Playback is synthesized from detected pitches, not the original audio. |
| **Speed / resources** | Demucs on CPU is slow for long tracks. Prefer short clips while experimenting. |

## Project layout

```
guitar-tabber/
  main.py
  requirements.txt
  README.md
  guitar_tabber/
    __main__.py      # python -m guitar_tabber
    cli.py           # --open-viewer, etc.
    pipeline.py      # extract → separate → pitch → tab/json/midi
    export.py        # .tab.json + pure-Python .mid writer
    audio.py
    separation.py    # Demucs
    pitch.py         # librosa.pyin
    fretboard.py     # MIDI ↔ frets
    tab.py           # ASCII formatter
  viewer/
    index.html       # Guitar Pro–style UI (no build)
    styles.css
    app.js           # Tone.js playback + highlight
    demo.tab.json    # open_a fixture notes
  tests/
    generate_test_audio.py
    test_export.py
    fixtures/        # created by the generator
```

## License

Demo / research tool. Demucs and model weights are subject to their own licenses (Facebook Research / Meta Demucs).
