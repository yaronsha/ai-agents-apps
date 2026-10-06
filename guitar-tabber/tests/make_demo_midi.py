"""Write tests/fixtures/demo_riff.mid: a short guitar part for trying the browser viewer.

    python tests/make_demo_midi.py
    python -m guitar_tabber tests/fixtures/demo_riff.mid --open
"""

from pathlib import Path

import mido

PPQ = 480
E8, Q, H = PPQ // 2, PPQ, PPQ * 2

# (start_in_eighths, length_in_eighths, [midi pitches])
PART = [
    # Bars 1-2: A minor pentatonic lick
    *[(i, 1, [p]) for i, p in enumerate([57, 60, 62, 64, 62, 60, 57, 55])],
    *[(8 + i, 1, [p]) for i, p in enumerate([57, 60, 62, 67, 64, 62, 60, 62])],
    # Bars 3-4: power chords A5 – C5 – D5 – G5 (quarter + held)
    (16, 2, [45, 52, 57]), (18, 2, [45, 52, 57]), (20, 1, [48, 55, 60]), (21, 3, [48, 55, 60]),
    (24, 2, [50, 57, 62]), (26, 2, [50, 57, 62]), (28, 4, [43, 50, 55]),
    # Bars 5-6: Am and F arpeggios
    *[(32 + i, 1, [p]) for i, p in enumerate([45, 52, 57, 60, 64, 60, 57, 52])],
    *[(40 + i, 1, [p]) for i, p in enumerate([41, 48, 53, 57, 60, 57, 53, 48])],
    # Bars 7-8: C – G chords, then a high bend-ish lick and final Am chord
    (48, 4, [48, 52, 55, 60, 64]), (52, 4, [43, 47, 50, 55, 59, 67]),
    *[(56 + i, 1, [p]) for i, p in enumerate([76, 74, 72, 69])],
    (60, 4, [45, 52, 57, 60, 64]),
]


def main() -> Path:
    out = Path(__file__).parent / "fixtures" / "demo_riff.mid"
    out.parent.mkdir(parents=True, exist_ok=True)
    events = []
    for start, length, pitches in PART:
        for p in pitches:
            events.append((start * E8, 1, mido.Message("note_on", note=p, velocity=96)))
            events.append(((start + length) * E8 - 10, 0, mido.Message("note_off", note=p, velocity=0)))
    events.sort(key=lambda e: (e[0], e[1]))
    track = mido.MidiTrack([
        mido.MetaMessage("track_name", name="Lead Guitar", time=0),
        mido.MetaMessage("set_tempo", tempo=mido.bpm2tempo(96), time=0),
        mido.MetaMessage("time_signature", numerator=4, denominator=4, time=0),
        mido.Message("program_change", program=29, time=0),
    ])
    last = 0
    for tick, _, msg in events:
        track.append(msg.copy(time=tick - last))
        last = tick
    mid = mido.MidiFile(type=1, ticks_per_beat=PPQ)
    mid.tracks.append(track)
    mid.save(out)
    print(f"wrote {out}")
    return out


if __name__ == "__main__":
    main()
