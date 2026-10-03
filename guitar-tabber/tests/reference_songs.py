"""Reference melodies with known tablature, for accuracy testing.

All tunes are public domain (traditional / pre-1900 compositions) or simple
exercises. Each note is (string_index, fret, beats), string_index 0 = low E.
"""

from __future__ import annotations

from dataclasses import dataclass

OPEN_STRING_MIDI = (40, 45, 50, 55, 59, 64)

# string indices
E, A, D, G, B, e = range(6)


@dataclass(frozen=True)
class RefNote:
    time: float
    duration: float
    string_index: int
    fret: int

    @property
    def midi(self) -> int:
        return OPEN_STRING_MIDI[self.string_index] + self.fret


@dataclass(frozen=True)
class RefSong:
    name: str
    bpm: float
    notes: tuple[RefNote, ...]
    polyphonic: bool = False


def _seq(name: str, bpm: float, events, lead_in: float = 0.25) -> RefSong:
    beat = 60.0 / bpm
    t = lead_in
    notes = []
    for s, f, beats in events:
        notes.append(RefNote(t, beats * beat, s, f))
        t += beats * beat
    return RefSong(name, bpm, tuple(notes))


# Beethoven, "Ode to Joy" (1824), first-position melody.
# Exercises repeated notes (E E, G G, C C) and semitone steps (E-F).
ODE_TO_JOY = _seq(
    "ode_to_joy",
    110,
    [
        (e, 0, 1), (e, 0, 1), (e, 1, 1), (e, 3, 1),
        (e, 3, 1), (e, 1, 1), (e, 0, 1), (B, 3, 1),
        (B, 1, 1), (B, 1, 1), (B, 3, 1), (e, 0, 1),
        (e, 0, 1.5), (B, 3, 0.5), (B, 3, 2),
    ],
)

# Traditional, "Greensleeves" (16th c.), opening phrase in A minor.
# Exercises semitone steps (E-F, G#-A) and a repeated A.
GREENSLEEVES = _seq(
    "greensleeves",
    150,
    [
        (G, 2, 1),
        (B, 1, 2), (B, 3, 1), (e, 0, 1.5), (e, 1, 0.5), (e, 0, 1),
        (B, 3, 2), (B, 0, 1), (G, 0, 1.5), (G, 2, 0.5), (B, 0, 1),
        (B, 1, 2), (G, 2, 1), (G, 2, 1.5), (G, 1, 0.5), (G, 2, 1),
        (B, 0, 2), (G, 1, 1), (D, 2, 2),
    ],
)

# A minor pentatonic, 5th position, up and down in eighth notes.
# Pitches are unambiguous but the expected fingering is NOT the lowest fret.
_PENTA_UP = [
    (E, 5), (E, 8), (A, 5), (A, 7), (D, 5), (D, 7),
    (G, 5), (G, 7), (B, 5), (B, 8), (e, 5), (e, 8),
]
PENTATONIC_5TH = _seq(
    "pentatonic_5th_pos",
    100,
    [(s, f, 0.5) for s, f in _PENTA_UP + _PENTA_UP[-2::-1]],
)

# Repeated re-plucked notes on one pitch (eighths), then a chromatic walk.
REPEATS_AND_CHROMATIC = _seq(
    "repeats_and_chromatic",
    120,
    [(A, 0, 0.5)] * 8
    + [(A, f, 0.5) for f in range(0, 6)]
    + [(D, 0, 0.5)] * 4
    + [(D, f, 0.5) for f in (1, 2, 3, 4)],
)


def _romanza() -> RefSong:
    """Anonymous, "Spanish Romance" opening (19th c.): triplet arpeggios, bass on beat."""
    bpm = 75
    trip = 60.0 / bpm / 3
    t = 0.25
    melody = [7, 7, 7, 7, 5, 3, 3, 2, 0]
    notes = []
    for bar in range(3):
        bass = RefNote(t, trip * 9, E, 0)
        notes.append(bass)
        for k in range(3):
            top = melody[bar * 3 + k]
            notes.append(RefNote(t, trip, e, top))
            notes.append(RefNote(t + trip, trip, B, 0))
            notes.append(RefNote(t + 2 * trip, trip, G, 0))
            t += 3 * trip
    notes.sort(key=lambda n: (n.time, n.string_index))
    return RefSong("romanza_poly", bpm, tuple(notes), polyphonic=True)


ROMANZA = _romanza()

SONGS = (ODE_TO_JOY, GREENSLEEVES, PENTATONIC_5TH, REPEATS_AND_CHROMATIC, ROMANZA)
