"""ASCII guitar tablature formatting."""

from __future__ import annotations

from typing import TYPE_CHECKING

from .fretboard import FretPosition, map_sequence_to_frets

if TYPE_CHECKING:  # pitch.py pulls in librosa; only the type is needed here
    from .pitch import DetectedNote

# Tab display order: high e on top
TAB_STRING_ORDER = (5, 4, 3, 2, 1, 0)  # high e → low E
TAB_LABELS = {5: "e", 4: "B", 3: "G", 2: "D", 1: "A", 0: "E"}
MAX_HELD_NOTE = 2.0  # seconds; longer detected notes are treated as this long


def group_chords(
    notes: list[DetectedNote],
    chord_window: float = 0.05,
) -> list[list[DetectedNote]]:
    """Split time-sorted notes into clusters that start within ``chord_window``."""
    clusters: list[list[DetectedNote]] = []
    for note in notes:
        if clusters and note.time - clusters[-1][0].time <= chord_window:
            clusters[-1].append(note)
        else:
            clusters.append([note])
    return clusters


def _silences(
    clusters: list[list[DetectedNote]], fingerings: list[tuple[FretPosition, ...]] | None
) -> list[float]:
    """
    Seconds the fretting hand has been free before each cluster: since the
    last earlier fretted note stopped (all notes count when fingerings is
    None). Over-long detected durations are capped at MAX_HELD_NOTE.
    """
    silences = []
    held_until = clusters[0][0].time if clusters else 0.0
    for k, cluster in enumerate(clusters):
        silences.append(max(0.0, cluster[0].time - held_until))
        open_midis = (
            {p.midi for p in fingerings[k] if p.fret == 0} if fingerings is not None else set()
        )
        for n in cluster:
            if n.midi not in open_midis:
                held_until = max(held_until, n.time + min(n.duration, MAX_HELD_NOTE))
    return silences


def tab_fingerings(
    notes: list[DetectedNote], chord_window: float = 0.05
) -> tuple[list[dict[int, int]], list[FretPosition | None]]:
    """
    Choose fingerings for the whole sequence.

    Returns (frames, positions): the chord frames for format_ascii_tab
    (string_index → fret) and the position chosen for each note, in order.
    """
    clusters = group_chords(notes, chord_window)
    midis = [[n.midi for n in c] for c in clusters]
    # Rests depend on which notes are fretted (a held fretted note keeps the
    # hand busy, a ringing open string does not), and that depends on the
    # fingering. So pick fingerings assuming every note holds the hand, then
    # again with rests measured from the fretted notes of that first pick.
    fingerings = map_sequence_to_frets(midis, silences=_silences(clusters, None))
    fingerings = map_sequence_to_frets(midis, silences=_silences(clusters, fingerings))

    frames = [{p.string_index: p.fret for p in f} for f in fingerings if f]
    positions: list[FretPosition | None] = []
    for cluster, fingering in zip(clusters, fingerings):
        for n in cluster:
            positions.append(next((p for p in fingering if p.midi == n.midi), None))
    return frames, positions


def format_ascii_tab(
    frames: list[dict[int, int]],
    columns_per_bar: int = 8,
    spacer: int = 2,
) -> str:
    """
    Render frames as ASCII tablature.

    Example:
        e|--0-----2--|
        B|--1-----3--|
        ...
    """
    if not frames:
        return _empty_tab_message()

    col_widths: list[int] = []
    for frame in frames:
        max_digits = max((len(str(f)) for f in frame.values()), default=1)
        col_widths.append(max(max_digits, 1))

    lines: dict[int, list[str]] = {s: [] for s in TAB_STRING_ORDER}
    for idx, frame in enumerate(frames):
        w = col_widths[idx]
        for s in TAB_STRING_ORDER:
            if s in frame:
                token = str(frame[s]).ljust(w, "-")
            else:
                token = "-" * w
            lines[s].append(token)
            lines[s].append("-" * spacer)

    out_lines: list[str] = []
    for s in TAB_STRING_ORDER:
        parts = lines[s]
        chunks: list[str] = []
        note_idx = 0
        i = 0
        current = ""
        while i < len(parts):
            current += parts[i]
            if i + 1 < len(parts):
                current += parts[i + 1]
            note_idx += 1
            i += 2
            if note_idx % columns_per_bar == 0:
                chunks.append(current)
                current = ""
        if current:
            chunks.append(current)
        body = "|".join(chunks)
        out_lines.append(f"{TAB_LABELS[s]}|{body}|")

    return "\n".join(out_lines)


def _empty_tab_message() -> str:
    blank = "\n".join(f"{TAB_LABELS[s]}|----------|" for s in TAB_STRING_ORDER)
    return blank + "\n(no notes detected)"


def format_note_log(notes: list[DetectedNote], positions: list[FretPosition | None]) -> str:
    """Human-readable note list for debugging, with the positions from tab_fingerings."""
    if len(positions) != len(notes):
        raise ValueError(f"got {len(positions)} positions for {len(notes)} notes")
    rows = ["#  time    dur     Hz     MIDI  fretboard"]
    for i, (n, pos) in enumerate(zip(notes, positions)):
        pos_str = f"{pos.string_name}{pos.fret}" if pos else "?"
        rows.append(
            f"{i:02d} {n.time:6.2f}  {n.duration:5.2f}  {n.hz:7.1f}  {n.midi:4d}  {pos_str}"
        )
    return "\n".join(rows)
