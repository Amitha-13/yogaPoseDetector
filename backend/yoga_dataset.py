"""
Export finalized sessions into YogaDataset hierarchy:

  {drive}/YogaDataset/YYYY-MM-DD_session/
    A_VideoOnly/
    B_Video_IMU/
    C_Video_IMU_Footrest/
      {PARTICIPANT}_{INITIALS}_{ID}/
        {PoseName}_{PoseId}/
          metadata.json, landmarks.json, video.webm, imu_data.jsonl (when applicable)
"""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

BODY_SENSOR_IDS = {f"imu{i}" for i in range(1, 11)}
FOOTREST_SENSOR_IDS = {f"imu{i}" for i in range(11, 27)}

COLLECTION_TYPE_DIRS = {
    "A_VideoOnly": "A_VideoOnly",
    "B_Video_IMU": "B_Video_IMU",
    "C_Video_IMU_Footrest": "C_Video_IMU_Footrest",
}

YOGA_DATASET_FOLDER = "YogaDataset"


def storage_root_for_location(storage_location: str | None) -> Path:
    loc = (storage_location or "D").strip().upper()
    if loc.startswith("E"):
        return Path(r"E:\YogaDataset")
    return Path(r"D:\YogaDataset")


def drive_volume_available(drive_letter: str) -> bool:
    letter = drive_letter.strip().upper().rstrip(":")
    if letter == "D":
        return Path(r"D:\\").exists()
    if letter == "E":
        return Path(r"E:\\").exists()
    return False


def list_storage_volumes() -> dict[str, Any]:
    e_exists = drive_volume_available("E")
    return {
        "volumes": [
            {"id": "D", "label": "D:\\ Local Drive", "available": drive_volume_available("D")},
            {
                "id": "E",
                "label": "E:\\ External Hard Disk",
                "available": e_exists,
                "note": None if e_exists else "Not Connected",
            },
        ],
        "default": "D",
    }


def _sanitize_token(value: str, *, fallback: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9_-]", "_", (value or "").strip())
    cleaned = re.sub(r"_+", "_", cleaned).strip("_")
    return (cleaned[:80] if cleaned else fallback)


def participant_folder_name(participant_name: str | None, participant_id: str | None) -> str:
    from participant_naming import participant_folder_name as _folder_name

    return _folder_name(participant_name, participant_id)


def pose_folder_name(pose_name: str | None, pose_id: str | None) -> str:
    pname = _sanitize_token((pose_name or "Pose").replace(" ", "_"), fallback="Pose")
    pid = _sanitize_token(pose_id or "POSE", fallback="POSE")
    return f"{pname}_{pid}"


def session_day_folder_name(when: datetime | None = None) -> str:
    dt = when or datetime.now()
    return f"{dt.strftime('%Y-%m-%d')}_session"


def _filter_imu_entries(entries: list[Any], collection_type: str) -> list[Any]:
    if collection_type == "A_VideoOnly":
        return []
    allowed = BODY_SENSOR_IDS
    if collection_type == "C_Video_IMU_Footrest":
        allowed = BODY_SENSOR_IDS | FOOTREST_SENSOR_IDS
    filtered = []
    for item in entries:
        if not isinstance(item, dict):
            continue
        sid = str(item.get("sensor_id", "")).lower()
        if sid in allowed:
            filtered.append(item)
    return filtered


def _read_imu_entries(imu_path: Path) -> list[Any]:
    if not imu_path.exists():
        return []
    text = imu_path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    if text.startswith("["):
        try:
            data = json.loads(text)
            return data if isinstance(data, list) else []
        except json.JSONDecodeError:
            return []
    items = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return items


def _write_jsonl(path: Path, entries: list[Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        for entry in entries:
            f.write(json.dumps(entry, separators=(",", ":")) + "\n")


def export_session_to_yoga_dataset(
    staging_dir: Path,
    *,
    collection_type: str,
    storage_location: str,
    participant_name: str | None,
    participant_id: str | None,
    connected_imus: list[str] | None = None,
    connected_footrest_sensors: list[str] | None = None,
    session_metadata_extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Copy pose artifacts from staging session folder into YogaDataset layout."""
    if not staging_dir.is_dir():
        return {"ok": False, "error": "staging_directory_missing"}

    ctype = collection_type if collection_type in COLLECTION_TYPE_DIRS else "A_VideoOnly"
    type_dir_name = COLLECTION_TYPE_DIRS[ctype]
    root = storage_root_for_location(storage_location)
    day_name = session_day_folder_name()
    participant_name_folder = participant_folder_name(participant_name, participant_id)

    dest_base = root / day_name / type_dir_name / participant_name_folder
    dest_base.mkdir(parents=True, exist_ok=True)

    exported_poses: list[str] = []

    for child in sorted(staging_dir.iterdir()):
        if not child.is_dir():
            continue
        meta_path = child / "metadata.json"
        if not meta_path.exists():
            continue
        try:
            pose_meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        if pose_meta.get("skipped"):
            continue

        pose_id = pose_meta.get("poseId") or child.name.split("_")[0]
        pose_name = pose_meta.get("poseName") or child.name
        dest_pose = dest_base / pose_folder_name(pose_name, pose_id)
        dest_pose.mkdir(parents=True, exist_ok=True)

        landmarks_src = child / "landmarks.json"
        if landmarks_src.exists():
            from pose_landmark_schema import write_landmarks_json

            try:
                raw_landmarks = json.loads(landmarks_src.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                raw_landmarks = []
            write_landmarks_json(dest_pose / "landmarks.json", raw_landmarks)

        video_src = child / "video.webm"
        if video_src.exists():
            shutil.copy2(video_src, dest_pose / "video.webm")

        imu_src = child / "imu_data.json"
        if not imu_src.exists():
            imu_src = child / "imu_data.jsonl"
        imu_entries = _filter_imu_entries(_read_imu_entries(imu_src), ctype)
        if imu_entries and ctype != "A_VideoOnly":
            _write_jsonl(dest_pose / "imu_data.jsonl", imu_entries)

        out_meta = dict(pose_meta)
        out_meta["collectionType"] = ctype
        out_meta["storageLocation"] = storage_location
        out_meta["landmarks_file"] = "landmarks.json" if landmarks_src.exists() else None
        out_meta["video_file"] = "video.webm" if video_src.exists() else None
        out_meta["imu_file"] = "imu_data.jsonl" if imu_entries else None
        (dest_pose / "metadata.json").write_text(
            json.dumps(out_meta, indent=2), encoding="utf-8"
        )
        exported_poses.append(str(dest_pose))

    session_meta_path = staging_dir / "metadata.json"
    session_meta: dict[str, Any] = {}
    if session_meta_path.exists():
        try:
            session_meta = json.loads(session_meta_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            session_meta = {}

    session_meta.update(session_metadata_extra or {})
    session_meta["collectionType"] = ctype
    session_meta["storageLocation"] = storage_location
    session_meta["connectedImus"] = connected_imus or []
    session_meta["connectedFootrestSensors"] = connected_footrest_sensors or []
    session_meta["yoga_dataset_directory"] = str(dest_base)
    session_meta["storage_layout"] = "YogaDataset/session_day/collection_type/participant/pose"
    (dest_base / "metadata.json").write_text(
        json.dumps(session_meta, indent=2), encoding="utf-8"
    )

    for other_type, other_name in COLLECTION_TYPE_DIRS.items():
        if other_type == ctype:
            continue
        placeholder = root / day_name / other_name
        placeholder.mkdir(parents=True, exist_ok=True)

    return {
        "ok": True,
        "yoga_dataset_root": str(root),
        "directory": str(dest_base),
        "collection_type": ctype,
        "poses_exported": len(exported_poses),
        "pose_directories": exported_poses,
    }
