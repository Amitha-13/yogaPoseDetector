"""
Flask REST bridge for ESP32 IMU UDP packets.
UDP :8080 — JSON payloads per device
HTTP :5000 — /sync (session t0), /data-with-ts (latest snapshot + relative time)
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

from flask import Flask, jsonify, request
from flask_cors import CORS

UDP_HOST = "0.0.0.0"
UDP_PORT = 8080
HTTP_PORT = 5000

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

_lock = threading.Lock()
_t_zero_ms: int | None = None
_latest_devices: dict[str, dict[str, Any]] = {}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _relative_ts() -> int:
    with _lock:
        t0 = _t_zero_ms
    if t0 is None:
        return 0
    return _now_ms() - t0


@app.route("/sync", methods=["POST", "OPTIONS"])
def sync():
    if request.method == "OPTIONS":
        return "", 204
    global _t_zero_ms
    body = request.get_json(force=True, silent=True) or {}
    raw = body.get("tZero")
    if raw is None:
        t0 = _now_ms()
    else:
        try:
            t0 = int(raw)
        except (TypeError, ValueError):
            t0 = _now_ms()
    with _lock:
        _t_zero_ms = t0
    return jsonify({"ok": True, "tZero": t0})


@app.route("/data-with-ts", methods=["GET", "OPTIONS"])
def data_with_ts():
    if request.method == "OPTIONS":
        return "", 204
    with _lock:
        devices = {k: dict(v) for k, v in _latest_devices.items()}
    return jsonify({"relative_timestamp": _relative_ts(), "devices": devices})


def _udp_loop() -> None:
    import socket

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((UDP_HOST, UDP_PORT))
    while True:
        try:
            data, _addr = sock.recvfrom(65535)
            payload = json.loads(data.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue

        device_id = payload.get("id") or payload.get("device_id") or payload.get("deviceId")
        if not device_id:
            continue
        device_id = str(device_id)

        entry: dict[str, Any] = {
            "qr": payload.get("qr"),
            "qi": payload.get("qi"),
            "qj": payload.get("qj"),
            "qk": payload.get("qk"),
            "voltage": payload.get("voltage"),
            "soc": payload.get("soc"),
            "rssi": payload.get("rssi"),
        }
        for optional in ("ax", "ay", "az", "gx", "gy", "gz"):
            if optional in payload:
                entry[optional] = payload[optional]

        with _lock:
            _latest_devices[device_id] = entry


if __name__ == "__main__":
    t = threading.Thread(target=_udp_loop, daemon=True)
    t.start()
    app.run(host="0.0.0.0", port=HTTP_PORT, threaded=True)
