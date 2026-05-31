"""
MediaPipe Pose 33 landmark export schema (metadata once at document root).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

LANDMARK_SCHEMA = "MediaPipePose33"

MEDIAPIPE_POSE_33_LANDMARK_NAMES: list[str] = [
    "nose",
    "left_eye_inner",
    "left_eye",
    "left_eye_outer",
    "right_eye_inner",
    "right_eye",
    "right_eye_outer",
    "left_ear",
    "right_ear",
    "mouth_left",
    "mouth_right",
    "left_shoulder",
    "right_shoulder",
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_pinky",
    "right_pinky",
    "left_index",
    "right_index",
    "left_thumb",
    "right_thumb",
    "left_hip",
    "right_hip",
    "left_knee",
    "right_knee",
    "left_ankle",
    "right_ankle",
    "left_heel",
    "right_heel",
    "left_foot_index",
    "right_foot_index",
]

COORDINATE_SYSTEM = "normalized_0_to_1"
DEFAULT_SAMPLING_RATE = "30fps"

_COORD_KEYS = frozenset({"x", "y", "z", "visibility"})


def _strip_landmark_names(frames: list[Any]) -> list[Any]:
    cleaned_frames: list[Any] = []
    for frame in frames:
        if not isinstance(frame, dict):
            cleaned_frames.append(frame)
            continue
        row = dict(frame)
        landmarks = row.get("landmarks")
        if isinstance(landmarks, list):
            row["landmarks"] = [
                {k: lm[k] for k in _COORD_KEYS if k in lm}
                for lm in landmarks
                if isinstance(lm, dict)
            ]
        cleaned_frames.append(row)
    return cleaned_frames


def _extract_frames(data: Any) -> list[Any]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        frames = data.get("frames")
        if isinstance(frames, list):
            return frames
        landmarks = data.get("landmarks")
        if isinstance(landmarks, list) and landmarks and isinstance(landmarks[0], dict):
            if "frame_id" in landmarks[0] or "timestamp" in landmarks[0]:
                return landmarks
    return []


def build_landmarks_document(
    data: Any,
    *,
    sampling_rate: str = DEFAULT_SAMPLING_RATE,
) -> dict[str, Any]:
    """Wrap frame list with schema metadata; preserve frame contents."""
    if (
        isinstance(data, dict)
        and data.get("landmarkSchema") == LANDMARK_SCHEMA
        and isinstance(data.get("landmarkNames"), list)
    ):
        frames = _extract_frames(data)
        return {
            "landmarkSchema": LANDMARK_SCHEMA,
            "landmarkNames": list(MEDIAPIPE_POSE_33_LANDMARK_NAMES),
            "totalFrames": data.get("totalFrames", len(frames)),
            "samplingRate": data.get("samplingRate", sampling_rate),
            "coordinateSystem": data.get("coordinateSystem", COORDINATE_SYSTEM),
            "frames": _strip_landmark_names(frames),
        }

    frames = _strip_landmark_names(_extract_frames(data))
    return {
        "landmarkSchema": LANDMARK_SCHEMA,
        "landmarkNames": list(MEDIAPIPE_POSE_33_LANDMARK_NAMES),
        "totalFrames": len(frames),
        "samplingRate": sampling_rate,
        "coordinateSystem": COORDINATE_SYSTEM,
        "frames": frames,
    }


def write_landmarks_json(
    dest: Path,
    data: Any,
    *,
    sampling_rate: str = DEFAULT_SAMPLING_RATE,
) -> int:
    doc = build_landmarks_document(data, sampling_rate=sampling_rate)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    return int(doc["totalFrames"])
