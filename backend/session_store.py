"""
Offline session storage under SESSIONS_ROOT (default E:\\SensorData\\Sessions).

Each session folder: {username}_{timestamp} containing only:
  video.webm, landmarks.json, imu.json, metadata.json

Browser MediaRecorder WebM segments are stored in a temp directory, merged with
ffmpeg (-c copy) into video.webm, then temp files are deleted.
"""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import tempfile
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


def session_dir_name(participant_name: str | None, participant_id: str | None) -> str:
    """Folder: username_YYYYMMDD_HHMMSS"""
    username = _sanitize_participant_token(
        (participant_name or "participant").strip(),
        fallback="participant",
    )
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{username}_{ts}"


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
class ActiveSession:
    session_id: str
    directory: Path
    t_zero: float
    started_at: str
    sensor_ids: set[str] = field(default_factory=set)
    imu_writer: JsonlWriter | None = None
    landmarks_writer: JsonlWriter | None = None
    imu_sample_count: int = 0
    landmark_frame_count: int = 0
    video_fps: float = 30.0
    _video_segment_paths: list[Path] = field(default_factory=list)
    _temp_video_dir: Path | None = field(default=None, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    @property
    def imu_jsonl_path(self) -> Path:
        return self.directory / "imu.jsonl"

    @property
    def landmarks_jsonl_path(self) -> Path:
        return self.directory / "landmarks.jsonl"

    @property
    def imu_json_path(self) -> Path:
        return self.directory / "imu.json"

    @property
    def landmarks_json_path(self) -> Path:
        return self.directory / "landmarks.json"

    @property
    def video_path(self) -> Path:
        return self.directory / "video.webm"

    @property
    def metadata_path(self) -> Path:
        return self.directory / "metadata.json"

    def ensure_temp_video_dir(self) -> Path:
        if self._temp_video_dir is None:
            self._temp_video_dir = Path(
                tempfile.mkdtemp(prefix=f"yoga_vid_{self.session_id}_")
            )
        return self._temp_video_dir


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
            session_id = session_dir_name(
                extra_data.get("participant_name"),
                extra_data.get("participant_id"),
            )
            directory = self.root / session_id
            directory.mkdir(parents=True, exist_ok=True)

            session = ActiveSession(
                session_id=session_id,
                directory=directory,
                t_zero=t0,
                started_at=datetime.now().isoformat(timespec="seconds"),
                video_fps=video_fps,
                imu_writer=JsonlWriter(directory / "imu.jsonl"),
                landmarks_writer=JsonlWriter(directory / "landmarks.jsonl"),
            )
            self.active = session

            meta_stub = {
                "session_id": session_id,
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

    def append_imu(self, payload: dict[str, Any]) -> bool:
        with self._lock:
            session = self.active
        if session is None or session.imu_writer is None:
            return False

        entry = imu_payload_to_entry(payload, session.t_zero)
        if entry is None:
            return False

        session.sensor_ids.add(entry["sensor_id"])
        session.imu_writer.append(entry)
        session.imu_sample_count += 1
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
        if session is None or session.landmarks_writer is None:
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

        session.landmarks_writer.append(row)
        session.landmark_frame_count += 1
        return True

    def append_webm_segment(self, webm_bytes: bytes) -> Path | None:
        """Store one browser MediaRecorder WebM blob (per pose recording)."""
        if not webm_bytes:
            return None
        with self._lock:
            session = self.active
            if session is None:
                return None
            temp_dir = session.ensure_temp_video_dir()
            seg_path = temp_dir / f"segment_{len(session._video_segment_paths):04d}.webm"
            seg_path.write_bytes(webm_bytes)
            session._video_segment_paths.append(seg_path)
            return seg_path

    def finalize_video(self) -> Path | None:
        """Merge WebM chunks into session video.webm."""
        with self._lock:
            session = self.active
        if session is None:
            return None
        return self._merge_video_segments(session)

    @staticmethod
    def _log_final_video(path: Path | None) -> None:
        if path is not None and path.exists():
            print("Final video file:", path)
            print("Video size:", os.path.getsize(path))

    def stop_video_capture(self) -> Path | None:
        """Alias used by API: merge WebM segments after a recording stops."""
        video_path = self.finalize_video()
        if video_path:
            self._log_final_video(video_path)
        return video_path

    def _merge_video_segments(self, session: ActiveSession) -> Path | None:
        chunk_segments = [
            p
            for p in session._video_segment_paths
            if p.exists() and p.stat().st_size > 0
        ]
        out = session.video_path

        segments: list[Path] = []
        if out.exists() and out.stat().st_size > 0:
            segments.append(out)
        segments.extend(chunk_segments)

        if not segments:
            return None

        if len(segments) == 1 and segments[0] == out:
            return out

        if len(segments) == 1:
            shutil.copy2(segments[0], out)
            self._remove_chunk_files(session, chunk_segments)
            return out if out.exists() else None

        temp_dir = session.ensure_temp_video_dir()
        list_file = temp_dir / "_concat_list.txt"
        lines = []
        for p in segments:
            path_str = str(p.resolve()).replace("\\", "/")
            lines.append(f"file '{path_str}'")
        list_file.write_text("\n".join(lines), encoding="utf-8")

        ffmpeg = shutil.which("ffmpeg")
        merged = False
        if ffmpeg:
            cmd = [
                ffmpeg,
                "-y",
                "-loglevel",
                "error",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(list_file),
                "-c",
                "copy",
                str(out),
            ]
            try:
                subprocess.run(
                    cmd,
                    check=True,
                    capture_output=True,
                    timeout=120,
                )
                merged = out.exists() and out.stat().st_size > 0
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
                merged = False

        if not merged:
            import cv2

            writer = None
            for seg in segments:
                cap = cv2.VideoCapture(str(seg))
                if not cap.isOpened():
                    continue
                w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
                h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                fps = cap.get(cv2.CAP_PROP_FPS) or session.video_fps
                if writer is None:
                    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
                    writer = cv2.VideoWriter(str(out), fourcc, fps, (w, h))
                while True:
                    ok, frame = cap.read()
                    if not ok:
                        break
                    writer.write(frame)
                cap.release()
            if writer is not None:
                writer.release()
            merged = out.exists() and out.stat().st_size > 0

        list_file.unlink(missing_ok=True)
        if merged:
            self._remove_chunk_files(session, chunk_segments)
            session._video_segment_paths.clear()
            return out
        return None

    @staticmethod
    def _remove_chunk_files(session: ActiveSession, chunk_paths: list[Path]) -> None:
        for path in chunk_paths:
            path.unlink(missing_ok=True)
        if session._temp_video_dir and session._temp_video_dir.exists():
            try:
                if not any(session._temp_video_dir.iterdir()):
                    session._temp_video_dir.rmdir()
            except OSError:
                pass

    @staticmethod
    def _remove_legacy_subdirs(session_dir: Path) -> None:
        """Remove old mediapipe/ or _video_segments/ folders if present."""
        for name in ("mediapipe", "_video_segments"):
            legacy = session_dir / name
            if legacy.exists():
                shutil.rmtree(legacy, ignore_errors=True)

    @staticmethod
    def _cleanup_temp_video_dir(session: ActiveSession) -> None:
        if session._temp_video_dir and session._temp_video_dir.exists():
            shutil.rmtree(session._temp_video_dir, ignore_errors=True)
        session._temp_video_dir = None
        session._video_segment_paths.clear()

    @staticmethod
    def _cleanup_recording_scratch_files(session: ActiveSession) -> None:
        session.imu_jsonl_path.unlink(missing_ok=True)
        session.landmarks_jsonl_path.unlink(missing_ok=True)

    def stop(self, *, extra_metadata: dict[str, Any] | None = None) -> dict[str, Any]:
        with self._lock:
            session = self.active
            self.active = None

        if session is None:
            return {"ok": False, "error": "no_active_session"}

        self.finalize_video()

        imu_count = 0
        landmark_count = 0
        imu_path = session.imu_json_path
        landmarks_path = session.landmarks_json_path

        if session.imu_writer:
            imu_count = session.imu_writer.finalize_array(imu_path)
            print("Saved imu:", imu_path)

        if session.landmarks_writer:
            landmark_count = session.landmarks_writer.finalize_array(landmarks_path)
            print("Saved landmarks:", landmarks_path)

        video_path = session.video_path if session.video_path.exists() else None
        if video_path is None or video_path.stat().st_size == 0:
            video_path = self._merge_video_segments(session)
        if video_path:
            self._log_final_video(video_path)

        self._cleanup_recording_scratch_files(session)
        self._cleanup_temp_video_dir(session)
        self._remove_legacy_subdirs(session.directory)

        ended_at = datetime.now().isoformat(timespec="seconds")
        duration_sec = max(0.0, time.time() - session.t_zero)

        metadata = {
            "session_id": session.session_id,
            "status": "complete",
            "started_at": session.started_at,
            "ended_at": ended_at,
            "duration_sec": round(duration_sec, 3),
            "t_zero": session.t_zero,
            "directory": str(session.directory),
            "sensor_ids": sorted(session.sensor_ids),
            "sensor_count": len(session.sensor_ids),
            "imu_sample_count": imu_count,
            "landmark_frame_count": landmark_count,
            "video_fps": session.video_fps,
            "video_file": "video.webm" if video_path else None,
            "video_format": "webm",
            "landmarks_file": "landmarks.json" if landmark_count else None,
            "imu_file": "imu.json" if imu_count else None,
            "imu_sampling_note": "per-packet UDP (device rate)",
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
        return {
            "active": True,
            "session_id": session.session_id,
            "directory": str(session.directory),
            "t_zero": session.t_zero,
            "sensor_ids": sorted(session.sensor_ids),
            "imu_samples": session.imu_sample_count,
            "landmark_frames": session.landmark_frame_count,
        }
