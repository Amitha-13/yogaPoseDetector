"""
In-memory live IMU state for UDP debug endpoint GET /debug/imu.
"""

from __future__ import annotations

import threading
import time
from typing import Any

from session_store import _normalize_quaternion, _vec3

OFFLINE_THRESHOLD_SEC = 3.0

latest_sensor_data: dict[str, dict[str, Any]] = {}


def _sensor_id(payload: dict[str, Any]) -> str | None:
    raw = (
        payload.get("id")
        or payload.get("device_id")
        or payload.get("deviceId")
        or payload.get("sensor_id")
    )
    return str(raw) if raw is not None else None


def _battery_percent(payload: dict[str, Any]) -> int | float | None:
    for key in ("soc", "battery", "battery_percent", "batteryPercent"):
        if key in payload and payload[key] is not None:
            try:
                return float(payload[key])
            except (TypeError, ValueError):
                continue
    return None


def _voltage(payload: dict[str, Any]) -> float | None:
    for key in ("voltage", "v"):
        if key in payload and payload[key] is not None:
            try:
                return float(payload[key])
            except (TypeError, ValueError):
                continue
    return None


def _rssi(payload: dict[str, Any]) -> int | float | None:
    if "rssi" not in payload or payload["rssi"] is None:
        return None
    try:
        return float(payload["rssi"])
    except (TypeError, ValueError):
        return None


class ImuDebugMonitor:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.latest_sensor_data = latest_sensor_data

    def ingest(self, payload: dict[str, Any]) -> bool:
        sensor_id = _sensor_id(payload)
        if not sensor_id:
            return False

        now = time.time()
        accel = _vec3(payload, "a")
        gyro = _vec3(payload, "g")
        quat = _normalize_quaternion(payload)

        with self._lock:
            prev = self.latest_sensor_data.get(sensor_id, {})
            packet_count = int(prev.get("packet_count", 0)) + 1
            self.latest_sensor_data[sensor_id] = {
                "timestamp": now,
                "last_received": now,
                "packet_count": packet_count,
                "accel": accel,
                "gyro": gyro,
                "quat": quat,
                "voltage": _voltage(payload),
                "battery": _battery_percent(payload),
                "rssi": _rssi(payload),
            }
        return True

    def get_debug_response(self) -> dict[str, Any]:
        now = time.time()
        with self._lock:
            snapshot = {k: dict(v) for k, v in self.latest_sensor_data.items()}

        response: dict[str, Any] = {}
        for sensor_id, data in sorted(snapshot.items()):
            last_received = float(data.get("last_received", 0))
            last_seen_sec_ago = max(0.0, now - last_received)
            online = last_seen_sec_ago <= OFFLINE_THRESHOLD_SEC

            row: dict[str, Any] = {
                "online": online,
                "last_seen_sec_ago": round(last_seen_sec_ago, 3),
                "packet_count": int(data.get("packet_count", 0)),
            }
            if data.get("quat") is not None:
                row["quat"] = data["quat"]
            if data.get("accel") is not None:
                row["accel"] = data["accel"]
            if data.get("gyro") is not None:
                row["gyro"] = data["gyro"]
            if data.get("battery") is not None:
                row["battery"] = data["battery"]
            if data.get("voltage") is not None:
                row["voltage"] = data["voltage"]
            if data.get("rssi") is not None:
                row["rssi"] = data["rssi"]
            response[sensor_id] = row

        return response


imu_monitor = ImuDebugMonitor()
