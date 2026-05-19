"""
Offline-first multi-sensor collection server.

UDP :5000  — ESP32 IMU JSON (append to imu.jsonl, finalized to imu.json)
HTTP :5001 — session control, status
WS   :5001/ws/landmarks — MediaPipe frames → landmarks.jsonl → landmarks.json
POST :5001/session/video/webm — browser MediaRecorder WebM → video.webm

Run: python data_collection_server.py
"""

from __future__ import annotations

import json
import socket
import threading
import time
from typing import Any

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from imu_debug_monitor import imu_monitor
from session_store import SESSIONS_ROOT, SessionStore

UDP_HOST = "0.0.0.0"
UDP_PORT = int(__import__("os").environ.get("IMU_UDP_PORT", "5000"))
HTTP_PORT = int(__import__("os").environ.get("COLLECTION_HTTP_PORT", "5001"))

store = SessionStore()
app = FastAPI(title="Offline Sensor Data Collection")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SessionStartBody(BaseModel):
    tZero: float | None = None
    videoFps: float | None = 30.0
    participantId: str | None = None
    participantName: str | None = None
    sessionNumber: int | None = None


class SessionStopBody(BaseModel):
    participantId: str | None = None
    participantName: str | None = None
    posesRecorded: int | None = None
    notes: str | None = None


class VideoStartBody(BaseModel):
    width: int = 1280
    height: int = 720
    fps: float | None = 30.0


def _udp_loop() -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind((UDP_HOST, UDP_PORT))
    print(f"[imu-udp] listening on {UDP_HOST}:{UDP_PORT}")
    while True:
        try:
            data, _addr = sock.recvfrom(65535)
            payload = json.loads(data.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            continue
        if isinstance(payload, dict):
            imu_monitor.ingest(payload)
            store.append_imu(payload)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "sessions_root": str(SESSIONS_ROOT), **store.status()}


@app.get("/debug/imu")
def debug_imu() -> dict[str, Any]:
    """Live ESP32 UDP feed — refresh to verify sensors on port 5000."""
    return imu_monitor.get_debug_response()


@app.get("/session/status")
def session_status() -> dict[str, Any]:
    return store.status()


@app.post("/session/start")
def session_start(body: SessionStartBody) -> dict[str, Any]:
    t0 = body.tZero
    if t0 is not None and t0 > 1e12:
        t0 = t0 / 1000.0
    extra = {
        k: v
        for k, v in {
            "participant_id": body.participantId,
            "participant_name": body.participantName,
            "session_number": body.sessionNumber,
        }.items()
        if v is not None
    }
    try:
        return store.start(
            t_zero=t0,
            video_fps=body.videoFps or 30.0,
            extra=extra,
        )
    except RuntimeError as e:
        return {"ok": False, "error": str(e)}


@app.post("/session/stop")
def session_stop(body: SessionStopBody | None = None) -> dict[str, Any]:
    extra = {}
    if body:
        extra = {
            k: v
            for k, v in {
                "participant_id": body.participantId,
                "participant_name": body.participantName,
                "poses_recorded": body.posesRecorded,
                "notes": body.notes,
            }.items()
            if v is not None
        }
    result = store.stop(extra_metadata=extra)
    if result.get("ok") and result.get("directory"):
        print("Session finalized:", result["directory"])
    return result


@app.post("/session/video/start")
def video_start(body: VideoStartBody) -> dict[str, Any]:
    """Legacy endpoint — video is captured in-browser as WebM."""
    return {"ok": True, "note": "Use POST /session/video/webm with MediaRecorder output"}


@app.post("/session/video/stop")
def video_stop() -> dict[str, Any]:
    """Merge any pending WebM segments (no upload in body)."""
    video_path = store.stop_video_capture()
    size = video_path.stat().st_size if video_path and video_path.exists() else 0
    return {
        "ok": True,
        "video_file": "video.webm" if video_path else None,
        "video_path": str(video_path) if video_path else None,
        "video_size": size,
    }


@app.post("/session/video/webm")
async def upload_webm(request: Request) -> dict[str, Any]:
    """Receive MediaRecorder WebM blob, append segment, merge to video.webm."""
    import os

    data = await request.body()
    if not data:
        return {"ok": False, "error": "empty_body"}

    seg = store.append_webm_segment(data)
    if seg is None:
        return {"ok": False, "error": "no_active_session"}

    video_path = store.finalize_video()
    size = os.path.getsize(video_path) if video_path and video_path.exists() else 0
    return {
        "ok": bool(video_path),
        "video_file": "video.webm" if video_path else None,
        "video_path": str(video_path) if video_path else None,
        "video_size": size,
        "segment": str(seg),
    }


@app.websocket("/ws/landmarks")
async def ws_landmarks(ws: WebSocket) -> None:
    await ws.accept()
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if not isinstance(msg, dict):
                continue
            landmarks = msg.get("landmarks")
            if not isinstance(landmarks, list):
                continue
            ts = msg.get("timestamp")
            frame_id = int(msg.get("frame_id", msg.get("frame", 0)))
            pose_id = msg.get("pose_id") or msg.get("poseId")
            cleaned = []
            for lm in landmarks:
                if not isinstance(lm, dict):
                    continue
                cleaned.append(
                    {
                        "x": float(lm.get("x", 0)),
                        "y": float(lm.get("y", 0)),
                        "z": float(lm.get("z", 0)),
                        "visibility": float(lm.get("visibility", lm.get("v", 0))),
                    }
                )
            if cleaned:
                store.append_landmarks(
                    timestamp=float(ts) if ts is not None else None,
                    frame_id=frame_id,
                    landmarks=cleaned,
                    pose_id=str(pose_id) if pose_id else None,
                )
    except WebSocketDisconnect:
        pass


@app.websocket("/ws/video")
async def ws_video(ws: WebSocket) -> None:
    """Deprecated — video is uploaded as WebM via POST /session/video/webm."""
    await ws.accept()
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
    except WebSocketDisconnect:
        pass


def main() -> None:
    SESSIONS_ROOT.mkdir(parents=True, exist_ok=True)
    t = threading.Thread(target=_udp_loop, daemon=True, name="imu-udp")
    t.start()
    print(f"[http] sessions root: {SESSIONS_ROOT}")
    print(f"[http] API http://0.0.0.0:{HTTP_PORT}")
    uvicorn.run(app, host="0.0.0.0", port=HTTP_PORT, log_level="info")


if __name__ == "__main__":
    main()
