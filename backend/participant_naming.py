"""Participant folder naming: NAME_PARTS_NNN (numeric suffix only)."""

from __future__ import annotations

import re
import zlib


def numeric_participant_suffix(participant_id: str | None) -> str:
    """Deterministic 3-digit numeric suffix from participant id (digits only)."""
    source = str(participant_id or "0")
    value = zlib.crc32(source.encode("utf-8")) & 0xFFFFFFFF
    return f"{value % 1000:03d}"


def participant_folder_name(
    participant_name: str | None,
    participant_id: str | None,
) -> str:
    """
    Examples:
      Devika -> DEVIKA_392
      Anjana M -> ANJANA_M_562
      Amitha Shaji K -> AMITHA_SHAJI_K_234
    """
    raw_name = (participant_name or "participant").strip()
    parts = [
        re.sub(r"[^a-zA-Z0-9]", "", token)
        for token in re.split(r"\s+", raw_name)
        if token and re.sub(r"[^a-zA-Z0-9]", "", token)
    ]
    name_token = "_".join(p.upper() for p in parts) if parts else "PARTICIPANT"
    suffix = numeric_participant_suffix(participant_id)
    return f"{name_token}_{suffix}"
