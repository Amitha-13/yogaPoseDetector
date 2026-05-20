"""
Offline session storage under SESSIONS_ROOT (default E:\\SensorData\\Sessions).

Layout:
  {SESSIONS_ROOT}/session_YYYY-MM-DD/{name}_{participantId}/{poseId}_{poseName}/
    video.webm, landmarks.json, metadata.json, imu_data.json (optional)
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

SESSIONS_ROOT = Path(
    os.environ.get("SESSIONS_ROOT", r"E:\SensorData\Sessions")
)


def _unix_timestamp() -> float:
    return time.time()


def _sanitize_participant_token(value: str, *, fallback: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in (value or "").strip())
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    return cleaned[:80] if cleaned else fallback


def session_day_dir_name(when: datetime | None = None) -> str:
    """Folder: session_YYYY-MM-DD"""
    dt = when or datetime.now()
    return f"session_{dt.strftime('%Y-%m-%d')}"


def participant_dir_name(
    participant_name: str | None,
    participant_id: str | None,
) -> str:
    """Folder: {name}_{participantId}"""
    name = _sanitize_participant_token(
        (participant_name or "participant").strip(),
        fallback="participant",
    )
    pid = _sanitize_participant_token(
        (participant_id or "unknown").strip(),
        fallback="unknown",
    )
    return f"{name}_{pid}"


def pose_dir_name(pose_id: str | None, pose_name: str | None) -> str:
    """Folder: {poseId}_{poseName}"""
    pid = _sanitize_participant_token((pose_id or "pose").strip(), fallback="pose")
    pname = _sanitize_participant_token(
        (pose_name or "pose").replace(" ", "_"),
        fallback="pose",
    )
    return f"{pid}_{pname}"


def session_dir_name(participant_name: str | None, participant_id: str | None) -> str:
    """Legacy helper — participant folder name only."""
    return participant_dir_name(participant_name, participant_id)


def _normalize_quaternion(payload: dict[str, Any]) -> list[float] | None:
    keys = ("qx", "qy", "qz", "qw")
    if all(k in payload for k in keys):
        try:
            return [float(payload[k]) for k in keys]
        except (TypeError, ValueError):
            return None
    if all(k in payload for k in ("qr", "qi", "qj", "qk")):
        try:
            return [
                float(payload["qi"]),
                float(payload["qj"]),
                float(payload["qk"]),
                float(payload["qr"]),
            ]
        except (TypeError, ValueError):
            return None
    return None


def _vec3(payload: dict[str, Any], prefix: str) -> list[float] | None:
    try:
        return [
            float(payload[f"{prefix}x"]),
            float(payload[f"{prefix}y"]),
            float(payload[f"{prefix}z"]),
        ]
    except (KeyError, TypeError, ValueError):
        return None


def imu_payload_to_entry(payload: dict[str, Any], t_zero: float) -> dict[str, Any] | None:
    device_id = (
        payload.get("id")
        or payload.get("device_id")
        or payload.get("deviceId")
        or payload.get("sensor_id")
    )
    if not device_id:
        return None

    quat = _normalize_quaternion(payload)
    if quat is None:
        return None

    accel = _vec3(payload, "a")
    gyro = _vec3(payload, "g")
    if accel is None:
        accel = [0.0, 0.0, 0.0]
    if gyro is None:
        gyro = [0.0, 0.0, 0.0]

    ts = _unix_timestamp()

    return {
        "timestamp": round(ts, 6),
        "sensor_id": str(device_id),
        "accel": accel,
        "gyro": gyro,
        "quat": quat,
        "_t_zero": t_zero,
    }


class JsonlWriter:
    """Append one JSON object per line; finalize to a JSON array file."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(exist_ok=True)

    def append(self, obj: dict[str, Any]) -> None:
        line = json.dumps(obj, separators=(",", ":"))
        with self._lock:
            with self.path.open("a", encoding="utf-8") as f:
                f.write(line + "\n")

    def finalize_array(self, dest: Path, *, drop_private: bool = True) -> int:
        items: list[Any] = []
        with self._lock:
            if self.path.exists():
                for line in self.path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if drop_private and isinstance(obj, dict):
                        obj = {k: v for k, v in obj.items() if not k.startswith("_")}
                    items.append(obj)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(json.dumps(items, indent=2), encoding="utf-8")
        return len(items)


@dataclass
class PoseRecording:
    pose_id: str
    pose_name: str
    directory: Path
    landmarks_writer: JsonlWriter
    imu_writer: JsonlWriter
    started_at: str
    t_pose_start: float
    landmark_frame_count: int = 0
    imu_sample_count: int = 0

    @property
    def landmarks_jsonl_path(self) -> Path:
        return self.directory / "landmarks.jsonl"

    @property
    def imu_jsonl_path(self) -> Path:
        return self.directory / "imu.jsonl"

    @property
    def landmarks_json_path(self) -> Path:
        return self.directory / "landmarks.json"

    @property
    def imu_json_path(self) -> Path:
        return self.directory / "imu_data.json"

    @property
    def video_path(self) -> Path:
        return self.directory / "video.webm"

    @property
    def metadata_path(self) -> Path:
        return self.directory / "metadata.json"


@dataclass
class ActiveSession:
    session_id: str
    session_day: str
    directory: Path
    t_zero: float
    started_at: str
    participant_id: str | None = None
    participant_name: str | None = None
    sensor_ids: set[str] = field(default_factory=set)
    video_fps: float = 30.0
    current_pose: PoseRecording | None = None
    poses_completed: list[str] = field(default_factory=list)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def metadata_path(self) -> Path:
        return self.directory / "metadata.json"


class SessionStore:
    def __init__(self, root: Path | None = None) -> None:
        self.root = root or SESSIONS_ROOT
        self._lock = threading.Lock()
        self.active: ActiveSession | None = None

    def start(
        self,
        *,
        t_zero: float | None = None,
        video_fps: float = 30.0,
        extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        with self._lock:
            if self.active is not None:
                raise RuntimeError("A session is already active")

            t0 = float(t_zero if t_zero is not None else time.time())
            extra_data = extra or {}
            participant_name = extra_data.get("participant_name")
            participant_id = extra_data.get("participant_id")
            session_day = session_day_dir_name()
            participant_folder = participant_dir_name(participant_name, participant_id)
            session_id = f"{session_day}/{participant_folder}"
            directory = self.root / session_day / participant_folder
            directory.mkdir(parents=True, exist_ok=True)

            session = ActiveSession(
                session_id=session_id,
                session_day=session_day,
                directory=directory,
                t_zero=t0,
                started_at=datetime.now().isoformat(timespec="seconds"),
                video_fps=video_fps,
                participant_id=str(participant_id) if participant_id else None,
                participant_name=str(participant_name) if participant_name else None,
            )
            self.active = session

            meta_stub = {
                "session_id": session_id,
                "session_day": session_day,
                "status": "recording",
                "started_at": session.started_at,
                "t_zero": t0,
                "directory": str(directory),
                **(extra or {}),
            }
            session.metadata_path.write_text(
                json.dumps(meta_stub, indent=2), encoding="utf-8"
            )

            print("Session started:", directory)

            return {
                "ok": True,
                "session_id": session_id,
                "directory": str(directory),
                "t_zero": t0,
            }

    def begin_pose(self, *, pose_id: str, pose_name: str) -> dict[str, Any]:
        with self._lock:
            session = self.active
            if session is None:
                return {"ok": False, "error": "no_active_session"}

            self._finalize_current_pose_locked(session, metadata=None)

            folder_name = pose_dir_name(pose_id, pose_name)
            pose_dir = session.directory / folder_name
            if pose_dir.exists():
                shutil.rmtree(pose_dir, ignore_errors=True)
            pose_dir.mkdir(parents=True, exist_ok=True)

            t_pose = time.time()
            pose = PoseRecording(
                pose_id=pose_id,
                pose_name=pose_name,
                directory=pose_dir,
                landmarks_writer=JsonlWriter(pose_dir / "landmarks.jsonl"),
                imu_writer=JsonlWriter(pose_dir / "imu.jsonl"),
                started_at=datetime.now().isoformat(timespec="seconds"),
                t_pose_start=t_pose,
            )
            session.current_pose = pose

            print("Pose recording started:", pose_dir)

            return {
                "ok": True,
                "pose_id": pose_id,
                "pose_name": pose_name,
                "directory": str(pose_dir),
            }

    def append_imu(self, payload: dict[str, Any]) -> bool:
        with self._lock:
            session = self.active
            pose = session.current_pose if session else None
        if session is None or pose is None:
            return False

        entry = imu_payload_to_entry(payload, session.t_zero)
        if entry is None:
            return False

        session.sensor_ids.add(entry["sensor_id"])
        pose.imu_writer.append(entry)
        pose.imu_sample_count += 1
        return True

    def append_landmarks(
        self,
        *,
        timestamp: float | None,
        frame_id: int,
        landmarks: list[dict[str, Any]],
        pose_id: str | None = None,
    ) -> bool:
        with self._lock:
            session = self.active
            pose = session.current_pose if session else None
        if session is None or pose is None:
            return False

        ts = float(timestamp if timestamp is not None else _unix_timestamp())
        if ts > 1e12:
            ts /= 1000.0

        row: dict[str, Any] = {
            "timestamp": round(ts, 6),
            "frame_id": frame_id,
            "landmarks": landmarks,
        }
        if pose_id:
            row["pose_id"] = pose_id

        pose.landmarks_writer.append(row)
        pose.landmark_frame_count += 1
        return True

    def save_pose_webm(
        self,
        webm_bytes: bytes,
        *,
        pose_id: str | None = None,
        pose_name: str | None = None,
    ) -> Path | None:
        """Save one pose recording directly as video.webm (no cross-pose merge)."""
        if not webm_bytes:
            return None
        with self._lock:
            session = self.active
            if session is None:
                return None
            pose = session.current_pose

        if pose is None and pose_id and pose_name:
            self.begin_pose(pose_id=pose_id, pose_name=pose_name)

        with self._lock:
            session = self.active
            if session is None:
                return None
            pose = session.current_pose
            if pose is None:
                return None
            video_path = pose.video_path
            video_path.write_bytes(webm_bytes)
            print("Saved pose video:", video_path)
            print("Video size:", os.path.getsize(video_path))
            return video_path

    def append_webm_segment(self, webm_bytes: bytes) -> Path | None:
        """Legacy name — stores WebM for the active pose without merging."""
        return self.save_pose_webm(webm_bytes)

    def finalize_video(self) -> Path | None:
        """Return the current pose video path if present (no merge)."""
        with self._lock:
            session = self.active
            if session is None or session.current_pose is None:
                return None
            video_path = session.current_pose.video_path
            return video_path if video_path.exists() else None

    def stop_video_capture(self) -> Path | None:
        return self.finalize_video()

    def complete_pose(self, *, metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            session = self.active
            if session is None:
                return {"ok": False, "error": "no_active_session"}
            return self._finalize_current_pose_locked(session, metadata=metadata)

    def _finalize_current_pose_locked(
        self,
        session: ActiveSession,
        *,
        metadata: dict[str, Any] | None,
    ) -> dict[str, Any]:
        pose = session.current_pose
        if pose is None:
            return {"ok": True, "note": "no_active_pose"}

        landmark_count = pose.landmarks_writer.finalize_array(pose.landmarks_json_path)
        print("Saved landmarks:", pose.landmarks_json_path)

        imu_count = pose.imu_writer.finalize_array(pose.imu_json_path)
        if imu_count == 0 and pose.imu_json_path.exists():
            pose.imu_json_path.write_text("[]", encoding="utf-8")
        if imu_count:
            print("Saved IMU:", pose.imu_json_path)

        pose.landmarks_jsonl_path.unlink(missing_ok=True)
        pose.imu_jsonl_path.unlink(missing_ok=True)

        video_path = pose.video_path if pose.video_path.exists() else None
        meta = {
            "poseId": pose.pose_id,
            "poseName": pose.pose_name,
            "recordedAt": pose.started_at,
            "landmark_frame_count": landmark_count,
            "imu_sample_count": imu_count,
            "video_file": "video.webm" if video_path else None,
            "landmarks_file": "landmarks.json" if landmark_count else None,
            "imu_file": "imu_data.json" if imu_count else None,
            **(metadata or {}),
        }
        pose.metadata_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
        print("Saved pose metadata:", pose.metadata_path)

        session.poses_completed.append(pose_dir_name(pose.pose_id, pose.pose_name))
        session.current_pose = None

        return {
            "ok": True,
            "pose_id": pose.pose_id,
            "directory": str(pose.directory),
            "landmark_frame_count": landmark_count,
            "imu_sample_count": imu_count,
            "video_file": "video.webm" if video_path else None,
        }

    def stop(self, *, extra_metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            session = self.active
            self.active = None

        if session is None:
            return {"ok": False, "error": "no_active_session"}

        self._finalize_current_pose_locked(session, metadata=None)

        ended_at = datetime.now().isoformat(timespec="seconds")
        duration_sec = max(0.0, time.time() - session.t_zero)

        metadata = {
            "session_id": session.session_id,
            "session_day": session.session_day,
            "status": "complete",
            "started_at": session.started_at,
            "ended_at": ended_at,
            "duration_sec": round(duration_sec, 3),
            "t_zero": session.t_zero,
            "directory": str(session.directory),
            "poses_completed": list(session.poses_completed),
            "sensor_ids": sorted(session.sensor_ids),
            "sensor_count": len(session.sensor_ids),
            "video_fps": session.video_fps,
            "storage_layout": "session_day/participant/pose",
            "imu_sampling_note": "per-packet UDP (device rate), per pose folder as imu_data.json",
            "landmarks_fps_note": "browser requestAnimationFrame (~30)",
            "system": {
                "platform": platform.platform(),
                "python": platform.python_version(),
            },
            **(extra_metadata or {}),
        }
        session.metadata_path.write_text(
            json.dumps(metadata, indent=2), encoding="utf-8"
        )

        print("Session finalized:", session.directory)

        return {
            "ok": True,
            "session_id": session.session_id,
            "directory": str(session.directory),
            "metadata": metadata,
        }

    def status(self) -> dict[str, Any]:
        with self._lock:
            session = self.active
        if session is None:
            return {"active": False, "root": str(self.root)}
        pose = session.current_pose
        return {
            "active": True,
            "session_id": session.session_id,
            "directory": str(session.directory),
            "t_zero": session.t_zero,
            "sensor_ids": sorted(session.sensor_ids),
            "current_pose_id": pose.pose_id if pose else None,
            "current_pose_directory": str(pose.directory) if pose else None,
            "poses_completed": list(session.poses_completed),
        }
