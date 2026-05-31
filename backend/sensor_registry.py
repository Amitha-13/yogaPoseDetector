"""
Canonical IMU sensor definitions (IMU 1–26).

Live UDP data is merged at read time in imu_debug_monitor — no simulated packets.
When footrest hardware is available, connect streams using the same `id` values (imu11–imu26).
"""

from __future__ import annotations

from typing import Any, Literal

SensorStatus = Literal["active", "placeholder"]

# IMU 1–10: existing body sensors (unchanged)
_BODY_SLOTS: list[dict[str, Any]] = [
    {"id": "imu1", "label": "IMU 1", "body_part": "Right Wrist", "status": "active", "group": "body"},
    {"id": "imu2", "label": "IMU 2", "body_part": "Left Wrist", "status": "active", "group": "body"},
    {"id": "imu3", "label": "IMU 3", "body_part": "Right Ankle", "status": "active", "group": "body"},
    {"id": "imu4", "label": "IMU 4", "body_part": "Left Ankle", "status": "active", "group": "body"},
    {"id": "imu5", "label": "IMU 5", "body_part": "Right Knee", "status": "active", "group": "body"},
    {"id": "imu6", "label": "IMU 6", "body_part": "Left Knee", "status": "active", "group": "body"},
    {"id": "imu7", "label": "IMU 7", "body_part": "Lower Back", "status": "active", "group": "body"},
    {"id": "imu8", "label": "IMU 8", "body_part": "Right Shoulder", "status": "active", "group": "body"},
    {"id": "imu9", "label": "IMU 9", "body_part": "Left Shoulder", "status": "active", "group": "body"},
    {"id": "imu10", "label": "IMU 10", "body_part": "Head / Neck", "status": "active", "group": "body"},
]

_LEFT_FOOTREST: list[dict[str, Any]] = [
    {"id": f"imu{i}", "label": f"IMU {i}", "body_part": f"Left Footrest {i - 10}", "status": "placeholder", "group": "footrest_left"}
    for i in range(11, 19)
]

_RIGHT_FOOTREST: list[dict[str, Any]] = [
    {"id": f"imu{i}", "label": f"IMU {i}", "body_part": f"Right Footrest {i - 18}", "status": "placeholder", "group": "footrest_right"}
    for i in range(19, 27)
]

SENSOR_DEFINITIONS: list[dict[str, Any]] = _BODY_SLOTS + _LEFT_FOOTREST + _RIGHT_FOOTREST

ACTIVE_SENSOR_COUNT = sum(1 for s in SENSOR_DEFINITIONS if s["status"] == "active")
PLACEHOLDER_SENSOR_COUNT = sum(1 for s in SENSOR_DEFINITIONS if s["status"] == "placeholder")
TOTAL_SENSOR_COUNT = len(SENSOR_DEFINITIONS)

ACTIVE_SENSOR_IDS = [s["id"] for s in SENSOR_DEFINITIONS if s["status"] == "active"]
PLACEHOLDER_SENSOR_IDS = [s["id"] for s in SENSOR_DEFINITIONS if s["status"] == "placeholder"]

SENSOR_BY_ID: dict[str, dict[str, Any]] = {s["id"]: s for s in SENSOR_DEFINITIONS}


def offline_registry_row(defn: dict[str, Any]) -> dict[str, Any]:
    """Status row when no live UDP packets exist (not simulated sensor data)."""
    return {
        "online": False,
        "last_seen_sec_ago": None,
        "packet_count": 0,
        "registry_status": defn["status"],
        "placeholder": defn["status"] == "placeholder",
        "label": defn["label"],
        "body_part": defn["body_part"],
        "group": defn.get("group"),
    }


def merge_live_with_registry(live: dict[str, Any]) -> dict[str, Any]:
    """Merge UDP live state with full registry so all 26 slots appear in status APIs."""
    merged: dict[str, Any] = {}
    for defn in SENSOR_DEFINITIONS:
        sid = defn["id"]
        if sid in live and isinstance(live[sid], dict):
            row = dict(live[sid])
            row.setdefault("registry_status", defn["status"])
            row.setdefault("placeholder", defn["status"] == "placeholder")
            row.setdefault("label", defn["label"])
            row.setdefault("body_part", defn["body_part"])
            row.setdefault("group", defn.get("group"))
            merged[sid] = row
        else:
            merged[sid] = offline_registry_row(defn)
    return merged


def registry_document() -> dict[str, Any]:
    return {
        "total_sensor_count": TOTAL_SENSOR_COUNT,
        "active_sensor_count": ACTIVE_SENSOR_COUNT,
        "placeholder_sensor_count": PLACEHOLDER_SENSOR_COUNT,
        "active_sensor_ids": ACTIVE_SENSOR_IDS,
        "placeholder_sensor_ids": PLACEHOLDER_SENSOR_IDS,
        "sensors": [
            {
                "id": s["id"],
                "label": s["label"],
                "body_part": s["body_part"],
                "status": s["status"],
                "group": s.get("group"),
            }
            for s in SENSOR_DEFINITIONS
        ],
    }
