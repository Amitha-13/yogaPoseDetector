#!/usr/bin/env python3
"""
Upload sessions or sync YogaDataset to Google Drive.

YogaDataset (recommended, incremental mirror):
  python upload_sessions_to_gdrive.py --sync-yoga
  python upload_sessions_to_gdrive.py --sync-yoga --dry-run

Legacy zip-per-session upload (staging / old Sessions layout):
  python upload_sessions_to_gdrive.py
  python upload_sessions_to_gdrive.py "E:\\SensorData\\Sessions"
  python upload_sessions_to_gdrive.py --dry-run

Background service (every 5 minutes):
  python yoga_dataset_gdrive_sync.py --loop

Credentials (pick one):
  - backend/gdrive_service_account.json (preferred)
  - GOOGLE_APPLICATION_CREDENTIALS
  - backend/gdrive_credentials.json
  - Interactive OAuth: backend/gdrive_token.json

Does NOT run during recording.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import zipfile
from pathlib import Path

SESSIONS_DEFAULT = Path(
    os.environ.get("SESSIONS_ROOT", r"E:\SensorData\Sessions")
)

# Shared Drive folder "YogaDataset"
GDRIVE_PARENT_FOLDER_ID = os.environ.get(
    "YOGA_DATASET_FOLDER_ID", "1KyRLCML879M7x5LZic1s3ozYtH7Bfvo8"
)


def _load_google_deps():
    try:
        from google.oauth2 import service_account
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError as e:
        print(
            "Install upload dependencies:\n"
            "  pip install google-api-python-client google-auth google-auth-oauthlib",
            file=sys.stderr,
        )
        raise SystemExit(1) from e
    return (
        service_account,
        Credentials,
        InstalledAppFlow,
        Request,
        build,
        MediaFileUpload,
    )


SCOPES = ["https://www.googleapis.com/auth/drive.file"]


def get_drive_service():
    """Delegate to gdrive_sync (service account + shared folder)."""
    from gdrive_sync import get_drive_service as _get

    return _get()


def create_folder(service, name: str, parent_id: str) -> str:
    meta = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    f = service.files().create(body=meta, fields="id").execute()
    return f["id"]


def upload_file(service, path: Path, parent_id: str) -> str:
    from googleapiclient.http import MediaFileUpload

    mime, _ = mimetypes.guess_type(str(path))
    media = MediaFileUpload(str(path), mimetype=mime or "application/octet-stream")
    meta = {"name": path.name, "parents": [parent_id]}
    f = (
        service.files()
        .create(body=meta, media_body=media, fields="id,webViewLink")
        .execute()
    )
    return f.get("id", "")


def session_complete(session_dir: Path) -> bool:
    meta = session_dir / "metadata.json"
    if not meta.exists():
        return False
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    return data.get("status") == "complete"


def zip_session(session_dir: Path, dest: Path) -> None:
    with zipfile.ZipFile(dest, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path in session_dir.rglob("*"):
            if path.is_file() and path.name != dest.name:
                zf.write(path, arcname=path.relative_to(session_dir.parent))


def upload_single_session(
    session_dir: str | Path,
    *,
    parent_folder_id: str | None = None,
) -> dict:
    """Upload one session directory to Google Drive."""
    session_path = Path(session_dir)
    if not session_path.is_dir():
        raise FileNotFoundError(f"Session directory not found: {session_path}")

    if not session_complete(session_path):
        return {"ok": False, "error": "Session is incomplete or missing metadata.json"}

    parent_id = parent_folder_id or GDRIVE_PARENT_FOLDER_ID
    if not parent_id:
        return {
            "ok": False,
            "error": "Set YOGA_DATASET_FOLDER_ID env var or pass parent_folder_id",
        }

    marker = session_path / ".uploaded_to_gdrive"
    if marker.exists():
        try:
            data = json.loads(marker.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            data = {}
        return {
            "ok": True,
            "status": "already_uploaded",
            "message": "Session was already uploaded to Google Drive.",
            **data,
        }

    service = get_drive_service()
    zip_path = session_path.parent / f"{session_path.name}.zip"
    zip_session(session_path, zip_path)
    folder_id = create_folder(service, session_path.name, parent_id)
    file_id = upload_file(service, zip_path, folder_id)
    marker.write_text(
        json.dumps({"drive_folder_id": folder_id, "file_id": file_id}),
        encoding="utf-8",
    )
    zip_path.unlink(missing_ok=True)
    return {
        "ok": True,
        "status": "uploaded",
        "message": f"Uploaded {session_path.name} to Google Drive.",
        "drive_folder_id": folder_id,
        "file_id": file_id,
    }


def upload_sessions_to_gdrive(
    sessions_root: str | Path,
    *,
    parent_folder_id: str | None = None,
    dry_run: bool = False,
) -> list[dict]:
    root = Path(sessions_root)
    if not root.is_dir():
        raise FileNotFoundError(f"Sessions root not found: {root}")

    parent_id = parent_folder_id or GDRIVE_PARENT_FOLDER_ID
    if not parent_id and not dry_run:
        raise ValueError(
            "Set YOGA_DATASET_FOLDER_ID env var or pass --parent-folder-id"
        )

    results: list[dict] = []
    service = None if dry_run else get_drive_service()

    for session_dir in sorted(root.iterdir()):
        if not session_dir.is_dir() or session_dir.name.startswith("."):
            continue
        if not (session_dir / "metadata.json").exists():
            continue
        if not session_complete(session_dir):
            results.append(
                {"session": session_dir.name, "status": "skipped", "reason": "incomplete"}
            )
            continue

        marker = session_dir / ".uploaded_to_gdrive"
        if marker.exists():
            results.append({"session": session_dir.name, "status": "already_uploaded"})
            continue

        zip_path = session_dir.parent / f"{session_dir.name}.zip"
        if dry_run:
            results.append(
                {"session": session_dir.name, "status": "dry_run", "zip": str(zip_path)}
            )
            continue

        zip_session(session_dir, zip_path)
        folder_id = create_folder(service, session_dir.name, parent_id)
        file_id = upload_file(service, zip_path, folder_id)
        marker.write_text(json.dumps({"drive_folder_id": folder_id, "file_id": file_id}), encoding="utf-8")
        zip_path.unlink(missing_ok=True)
        results.append(
            {
                "session": session_dir.name,
                "status": "uploaded",
                "drive_folder_id": folder_id,
                "file_id": file_id,
            }
        )

    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload completed sessions to Google Drive")
    parser.add_argument(
        "sessions_root",
        nargs="?",
        default=str(SESSIONS_DEFAULT),
        help="Path to Sessions folder (legacy zip upload)",
    )
    parser.add_argument("--parent-folder-id", default=GDRIVE_PARENT_FOLDER_ID)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--sync-yoga",
        action="store_true",
        help="Incremental sync of D:/E: YogaDataset (see yoga_dataset_gdrive_sync.py)",
    )
    args = parser.parse_args()

    if args.sync_yoga:
        from gdrive_sync import run_incremental_sync

        result = run_incremental_sync(
            drive_parent_id=args.parent_folder_id or None,
            dry_run=args.dry_run,
        )
        print(json.dumps(result, indent=2))
        if not result.get("ok"):
            raise SystemExit(1)
        return

    results = upload_sessions_to_gdrive(
        args.sessions_root,
        parent_folder_id=args.parent_folder_id or None,
        dry_run=args.dry_run,
    )
    for row in results:
        print(json.dumps(row))
    uploaded = sum(1 for r in results if r.get("status") == "uploaded")
    print(f"Done. {uploaded} session(s) uploaded.")


if __name__ == "__main__":
    main()
