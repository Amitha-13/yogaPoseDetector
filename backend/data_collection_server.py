"""
Offline-first multi-sensor collection server.

UDP :5000  — ESP32 IMU JSON (per-pose imu_data.json while a pose is recording)
HTTP :5001 — session control, status
WS   :5001/ws/landmarks — MediaPipe frames → per-pose landmarks.json
POST :5001/session/video/webm — browser MediaRecorder WebM → pose folder video.webm
POST :5001/session/pose/start | /session/pose/complete — pose folder lifecycle

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
from fastapi.responses import FileResponse
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
    collectionType: str | None = None
    storageLocation: str | None = None
    connectedImus: list[str] | None = None
    connectedFootrestSensors: list[str] | None = None


class VideoStartBody(BaseModel):
    width: int = 1280
    height: int = 720
    fps: float | None = 30.0


class PoseStartBody(BaseModel):
    poseId: str
    poseName: str


class PoseCompleteBody(BaseModel):
    participantId: str | None = None
    poseName: str | None = None
    poseId: str | None = None
    sanskrit: str | None = None
    category: str | None = None
    variation: str | None = None
    duration: int | float | None = None
    recordedAt: str | None = None
    skipped: bool | None = None
    username: str | None = None
    sessionNumber: int | None = None
    name: str | None = None
    age: str | None = None
    gender: str | None = None
    height: str | None = None
    weight: str | None = None
    experience: str | None = None
    healthRemarks: str | None = None
    sessionDate: str | None = None


class GdriveUploadBody(BaseModel):
    directory: str | None = None


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


@app.get("/sensors/registry")
def sensors_registry() -> dict[str, Any]:
    """Canonical sensor slot definitions (IMU 1–26) for UI and future hardware integration."""
    from sensor_registry import registry_document

    return registry_document()


@app.get("/session/status")
def session_status() -> dict[str, Any]:
    return store.status()


@app.get("/storage/volumes")
def storage_volumes() -> dict[str, Any]:
    from yoga_dataset import list_storage_volumes

    return list_storage_volumes()


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
                "collectionType": body.collectionType,
                "storageLocation": body.storageLocation,
                "connectedImus": body.connectedImus,
                "connectedFootrestSensors": body.connectedFootrestSensors,
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
    """Return current pose video path if present."""
    video_path = store.stop_video_capture()
    size = video_path.stat().st_size if video_path and video_path.exists() else 0
    return {
        "ok": True,
        "video_file": "video.webm" if video_path else None,
        "video_path": str(video_path) if video_path else None,
        "video_size": size,
    }


@app.post("/session/pose/start")
def pose_start(body: PoseStartBody) -> dict[str, Any]:
    return store.begin_pose(pose_id=body.poseId, pose_name=body.poseName)


@app.post("/session/pose/complete")
def pose_complete(body: PoseCompleteBody) -> dict[str, Any]:
    meta = body.model_dump(exclude_none=True)
    return store.complete_pose(metadata=meta)


@app.post("/session/video/webm")
async def upload_webm(request: Request) -> dict[str, Any]:
    """Receive MediaRecorder WebM blob; save to active pose folder as video.webm."""
    import os

    data = await request.body()
    if not data:
        return {"ok": False, "error": "empty_body"}

    pose_id = request.query_params.get("poseId")
    pose_name = request.query_params.get("poseName")

    video_path = store.save_pose_webm(
        data,
        pose_id=pose_id,
        pose_name=pose_name,
    )
    if video_path is None:
        return {"ok": False, "error": "no_active_session_or_pose"}

    size = os.path.getsize(video_path) if video_path.exists() else 0
    return {
        "ok": True,
        "video_file": "video.webm",
        "video_path": str(video_path),
        "video_size": size,
    }


@app.post("/session/upload/gdrive")
def session_upload_gdrive(body: GdriveUploadBody | None = None) -> dict[str, Any]:
    """Upload a completed session folder to Google Drive from within the app."""
    from upload_sessions_to_gdrive import upload_single_session

    session_dir = (body.directory if body else None) or store.status().get("directory")
    if not session_dir:
        return {"ok": False, "error": "no_session_directory"}

    try:
        result = upload_single_session(session_dir)
        return result
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/session/download/zip")
def session_download_zip(directory: str | None = None) -> Any:
    """Download a session folder as a ZIP file."""
    import tempfile
    import zipfile
    from pathlib import Path

    session_dir = Path(directory) if directory else None
    if session_dir is None:
        status = store.status()
        session_dir = Path(status["directory"]) if status.get("directory") else None

    if session_dir is None or not session_dir.is_dir():
        return {"ok": False, "error": "no_session_directory"}

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()
    zip_path = Path(tmp.name)

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in session_dir.rglob("*"):
            if path.is_file():
                zf.write(path, arcname=path.relative_to(session_dir.parent))

    return FileResponse(
        path=str(zip_path),
        media_type="application/zip",
        filename=f"{session_dir.name}.zip",
    )


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
    t = threading.Thread(target=_udp_loop, daemon=True, name="imu-udp")
    t.start()
    print(f"[http] collection staging (temp): {SESSIONS_ROOT}")
    print("[http] exported datasets: D:\\YogaDataset or E:\\YogaDataset")
    print(f"[http] API http://0.0.0.0:{HTTP_PORT}")
    uvicorn.run(app, host="0.0.0.0", port=HTTP_PORT, log_level="info")


if __name__ == "__main__":
    main()
