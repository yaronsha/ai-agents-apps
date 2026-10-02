# Guitar Tabber

Convert an MP3/MP4 of a **full song** (guitar + other instruments + vocals) into
**guitar tablature** and view it in the browser, Guitar Pro style: real
tablature with rhythm and bars, playback with a guitar sound, and a cursor that
highlights the note being played (plus a fretboard showing where it is).

Pipeline:

1. **Extract** audio with `ffmpeg` (mono WAV)
2. **Separate** a guitar stem with **Demucs** (`htdemucs_6s` → dedicated `guitar` stem; falls back to `other` on 4-stem models)
3. **Detect** notes with **librosa.pyin** (monophonic pitch tracking + onsets)
4. **Map** MIDI pitches to a standard-tuning (EADGBE) fretboard (prefer lower frets)
5. **Emit** ASCII tablature to stdout and `<input>.tab.txt`
6. **Export** `<input>.mid` (tempo estimated from the mix) and
   `<input>.tab.html`, the browser viewer with the song embedded

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

# Known tempo? Skip the estimate (also adjustable later in the viewer)
python -m guitar_tabber song.mp3 --bpm 92

# MIDI file in, tabs out (no audio analysis); --open launches the browser
python -m guitar_tabber song.mid --open
```

## Browser tab viewer (`.tab.html`)

Open the generated `<input>.tab.html` in any modern browser (double-click
works, no server needed). It is built on [alphaTab](https://alphatab.net), the
open-source engine for Guitar Pro–style notation:

- Tablature with rhythm stems, bar lines and tempo; optionally standard notation (**View → Notes + Tab**)
- **Play / pause** (Space), stop, seek bar, **speed** 25–150%, loop, metronome, count-in
- Cursor plus orange highlighting of the notes playing now, and a **fretboard** showing them live
- Click a note to start there; shift-click to select a range (loop it with **Loop**)
- Several MIDI tracks: pick one under **Track** (it plays solo)
- **Export .gp** opens in Guitar Pro / TuxGuitar; **Print** gives a clean sheet
- **Open…** or drag and drop any other `.mid` file onto the page
- **Rhythm** bar: set the **tempo** (type it, ÷2 / ×2, or **Tap** / press `T` along with the
  song), where the **first beat** falls, and the **time signature**. The notes are
  re-placed into bars instantly in the browser; **Reset** goes back to the file's tempo

Fingering is chosen across the whole song (it keeps the hand in one position
and avoids impossible chord stretches), and rhythm is snapped to a 1/16 grid
(set **Grid** to 1/8 or 1/32 if it looks too busy or too coarse).

The page loads alphaTab and its guitar soundfont from the jsDelivr CDN, so it
needs an internet connection. The empty viewer is in
`guitar_tabber/web/viewer.html`: open it and drop a MIDI file on it.

Try it with the bundled demo:

```bash
python tests/make_demo_midi.py        # writes tests/fixtures/demo_riff.mid
python -m guitar_tabber tests/fixtures/demo_riff.mid --open
```

Text output example:

```
e|-----------|
B|-----------|
G|-----------|
D|-----------|
A|--0-----0--|
E|-----------|
```

A `.tab.txt` file is also written beside the input (or to `-o`), together with
`.mid` and `.tab.html` (turn them off with `--no-midi` / `--no-html`).

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
| **Timing / rhythm** | The ASCII tab is one column per note, with no rhythm. The browser viewer snaps notes to a beat grid built from the estimated tempo (assumes 4/4). If the tempo estimate is off, bars will not line up with the music: fix it in the viewer's **Rhythm** bar or pass `--bpm`. |
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
    midi_io.py       # notes ↔ .mid, tempo estimate
    viewer.py        # writes <input>.tab.html
    web/viewer.html  # browser viewer (alphaTab)
  tests/
    generate_test_audio.py
    make_demo_midi.py
    test_viewer.py
    fixtures/        # created by the generators
```

## License

Demo / research tool. Demucs and model weights are subject to their own licenses (Facebook Research / Meta Demucs).
