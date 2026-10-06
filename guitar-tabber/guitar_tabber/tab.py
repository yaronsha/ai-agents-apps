"""ASCII guitar tablature formatting."""

from __future__ import annotations

from .fretboard import FretPosition, map_sequence_to_frets
from .pitch import DetectedNote

# Tab display order: high e on top
TAB_STRING_ORDER = (5, 4, 3, 2, 1, 0)  # high e → low E
TAB_LABELS = {5: "e", 4: "B", 3: "G", 2: "D", 1: "A", 0: "E"}


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


def tab_fingerings(
    notes: list[DetectedNote], chord_window: float = 0.05
) -> tuple[list[dict[int, int]], list[FretPosition | None]]:
    """
    Choose fingerings for the whole sequence once.

    Returns (frames, positions): the chord frames for format_ascii_tab
    (string_index → fret) and the position chosen for each note, in order.
    """
    clusters = group_chords(notes, chord_window)
    # Silence before each cluster: from when every earlier note (a ringing
    # bass included) has stopped to this onset
    silences = []
    ringing_until = clusters[0][0].time if clusters else 0.0
    for cluster in clusters:
        silences.append(max(0.0, cluster[0].time - ringing_until))
        ringing_until = max(ringing_until, max(n.time + n.duration for n in cluster))
    fingerings = map_sequence_to_frets([[n.midi for n in c] for c in clusters], silences=silences)

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
