#!/usr/bin/env python3
"""Render reference songs with sampled guitars and score the transcription.

Rendering uses FluidSynth with the FluidR3_GM soundfont (MIT licensed), which
contains real sampled nylon / steel / clean-electric guitars:

    sudo apt install fluidsynth fluid-soundfont-gm
    pip install mido

Usage:
    python tests/evaluate_accuracy.py            # all songs, all guitars
    python tests/evaluate_accuracy.py -v ode_to_joy
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

import mido

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from guitar_tabber.audio import load_audio  # noqa: E402
from guitar_tabber.fretboard import map_midi_to_fret  # noqa: E402
from guitar_tabber.pitch import detect_notes, merge_nearby_same_pitch  # noqa: E402
from reference_songs import SONGS, RefSong  # noqa: E402

SOUNDFONT = Path("/usr/share/sounds/sf2/FluidR3_GM.sf2")
OUT_DIR = Path(__file__).resolve().parent / "fixtures" / "reference"
GUITARS = {"nylon": 24, "steel": 25, "electric_clean": 27}
ONSET_TOL = 0.05  # seconds, same as mir_eval's default


def write_midi(song: RefSong, program: int, path: Path) -> None:
    tpb = 480
    sec_per_tick = 60.0 / song.bpm / tpb
    events = []
    for n in song.notes:
        # Let notes ring like a plucked string, up to the next note on the same string
        events.append((n.time, 1, n.midi))
        events.append((n.time + n.duration * 0.97, 0, n.midi))
    events.sort(key=lambda ev: (ev[0], ev[1]))
    mid = mido.MidiFile(ticks_per_beat=tpb)
    track = mido.MidiTrack()
    mid.tracks.append(track)
    track.append(mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(song.bpm)))
    track.append(mido.Message("program_change", program=program, channel=0))
    last_tick = 0
    for t, on, note in events:
        tick = int(round(t / sec_per_tick))
        msg = "note_on" if on else "note_off"
        track.append(mido.Message(msg, note=note, velocity=90, time=tick - last_tick))
        last_tick = tick
    track.append(mido.MetaMessage("end_of_track", time=tpb))
    mid.save(str(path))


def render(song: RefSong, guitar: str) -> Path:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mid_path = OUT_DIR / f"{song.name}_{guitar}.mid"
    wav_path = OUT_DIR / f"{song.name}_{guitar}.wav"
    if not wav_path.exists():
        write_midi(song, GUITARS[guitar], mid_path)
        subprocess.run(
            ["fluidsynth", "-ni", "-g", "0.8", "-r", "44100", "-F", str(wav_path),
             str(SOUNDFONT), str(mid_path)],
            check=True, capture_output=True,
        )
    return wav_path


def match(ref, est, key):
    """Greedy one-to-one onset match within ONSET_TOL where key(ref)==key(est)."""
    used = set()
    hits = 0
    for r in ref:
        best = None
        for j, n in enumerate(est):
            if j in used or abs(n[0] - r[0]) > ONSET_TOL or key(n) != key(r):
                continue
            if best is None or abs(n[0] - r[0]) < abs(est[best][0] - r[0]):
                best = j
        if best is not None:
            used.add(best)
            hits += 1
    return hits


def f1(hits: int, n_ref: int, n_est: int) -> float:
    if hits == 0:
        return 0.0
    p, r = hits / n_est, hits / n_ref
    return 2 * p * r / (p + r)


def evaluate(song: RefSong, guitar: str, verbose: bool = False) -> dict:
    wav = render(song, guitar)
    y, sr = load_audio(wav, sample_rate=22050)
    notes = merge_nearby_same_pitch(detect_notes(y, sr))

    ref = [(n.time, n.midi, n.string_index, n.fret) for n in song.notes]
    est = []
    for n in notes:
        pos = map_midi_to_fret(n.midi)
        est.append((n.time, n.midi, pos.string_index if pos else -1, pos.fret if pos else -1))

    pitch_hits = match(ref, est, key=lambda x: x[1])
    tab_hits = match(ref, est, key=lambda x: (x[2], x[3]))
    onset_hits = match(ref, est, key=lambda x: 0)
    # Pitch-class match within an octave tolerance tells octave errors apart
    chroma_hits = match(ref, est, key=lambda x: x[1] % 12)

    if verbose:
        print(f"\n== {song.name} / {guitar} ==")
        print("ref: " + " ".join(f"{'EADGBe'[s]}{f}" for _, _, s, f in ref))
        print("est: " + " ".join(f"{'EADGBe'[s]}{f}" for _, _, s, f in est))
        for t, m, s, f in est:
            print(f"   {t:6.2f}s midi={m:3d} {'EADGBe'[s]}{f}")

    return {
        "song": song.name,
        "guitar": guitar,
        "n_ref": len(ref),
        "n_est": len(est),
        "onset_f1": f1(onset_hits, len(ref), len(est)),
        "pitch_f1": f1(pitch_hits, len(ref), len(est)),
        "chroma_f1": f1(chroma_hits, len(ref), len(est)),
        "tab_f1": f1(tab_hits, len(ref), len(est)),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("songs", nargs="*")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--guitar", choices=list(GUITARS), action="append")
    args = ap.parse_args()

    songs = [s for s in SONGS if not args.songs or s.name in args.songs]
    guitars = args.guitar or list(GUITARS)
    rows = [evaluate(s, g, args.verbose) for s in songs for g in guitars]

    print(f"\n{'song':24s} {'guitar':15s} {'ref':>4s} {'est':>4s} "
          f"{'onsetF1':>8s} {'pitchF1':>8s} {'chromaF1':>9s} {'tabF1':>7s}")
    for r in rows:
        print(f"{r['song']:24s} {r['guitar']:15s} {r['n_ref']:4d} {r['n_est']:4d} "
              f"{r['onset_f1']:8.2f} {r['pitch_f1']:8.2f} {r['chroma_f1']:9.2f} {r['tab_f1']:7.2f}")
    mono = [r for r in rows if not any(s.polyphonic for s in SONGS if s.name == r["song"])]
    if mono:
        avg = {k: sum(r[k] for r in mono) / len(mono) for k in ("onset_f1", "pitch_f1", "tab_f1")}
        print(f"\nmonophonic mean: onsetF1={avg['onset_f1']:.2f} "
              f"pitchF1={avg['pitch_f1']:.2f} tabF1={avg['tab_f1']:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
