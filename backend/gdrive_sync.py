"""
Incremental Google Drive sync for local YogaDataset folders.

Mirrors {D|E}:\\YogaDataset\\** under the shared Drive folder (service account).
Offline-first: failures are logged; sync retries on the next cycle.
"""

from __future__ import annotations

import hashlib
import json
import logging
import mimetypes
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from yoga_dataset import drive_volume_available, storage_root_for_location

logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).resolve().parent
DEFAULT_CREDENTIALS = BACKEND_DIR / "gdrive_service_account.json"
LEGACY_CREDENTIALS = BACKEND_DIR / "gdrive_credentials.json"
SYNC_STATE_PATH = BACKEND_DIR / ".gdrive_sync_state.json"
SYNC_CONFIG_PATH = BACKEND_DIR / "dataset_sync_config.json"

DEFAULT_DRIVE_FOLDER_ID = "1KyRLCML879M7x5LZic1s3ozYtH7Bfvo8"
GDRIVE_PARENT_FOLDER_ID = os.environ.get(
    "YOGA_DATASET_FOLDER_ID", DEFAULT_DRIVE_FOLDER_ID
)
# Set when YogaDataset lives on a Google Shared Drive (Team Drive)
GDRIVE_SHARED_DRIVE_ID = os.environ.get("YOGA_GDRIVE_SHARED_DRIVE_ID", "").strip()

SCOPES = ["https://www.googleapis.com/auth/drive"]

_DRIVE_LIST_KW = {
    "supportsAllDrives": True,
    "includeItemsFromAllDrives": True,
}
_DRIVE_WRITE_KW = {"supportsAllDrives": True}
HASH_MAX_BYTES = 100 * 1024 * 1024

SKIP_DIR_NAMES = {".git", "__pycache__", ".uploaded_to_gdrive"}
SKIP_FILE_NAMES = {".gdrive_sync_state.json", "dataset_sync_config.json"}

_sync_lock = threading.Lock()
_runtime_status: dict[str, Any] = {
    "running": False,
    "last_sync_started": None,
    "last_sync_completed": None,
    "last_sync_success": None,
    "last_error": None,
    "files_uploaded": 0,
    "files_skipped": 0,
    "files_failed": 0,
    "pending_estimate": 0,
    "last_roots": [],
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def read_dataset_sync_config() -> dict[str, Any] | None:
    if not SYNC_CONFIG_PATH.exists():
        return None
    try:
        data = json.loads(SYNC_CONFIG_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        return None


def resolve_dataset_roots() -> list[Path]:
    """
    Determine local YogaDataset root(s) to sync.

    Prefer the last successful export location (dataset_sync_config.json).
    Fall back to every available D/E volume that has a YogaDataset folder.
    """
    roots: list[Path] = []
    cfg = read_dataset_sync_config()
    if cfg:
        loc = str(cfg.get("storage_location", "D"))
        root = Path(str(cfg.get("dataset_root") or storage_root_for_location(loc)))
        letter = loc.strip().upper()[:1]
        if not drive_volume_available(letter):
            logger.warning(
                "Configured drive %s: is unavailable; skipping sync this cycle",
                letter,
            )
        elif root.is_dir():
            roots.append(root)
        else:
            logger.warning("Dataset root missing: %s", root)
        return roots

    for letter in ("D", "E"):
        if not drive_volume_available(letter):
            continue
        root = storage_root_for_location(letter)
        if root.is_dir():
            roots.append(root)
    return roots


def _load_google_deps():
    try:
        from google.oauth2 import service_account
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError as e:
        raise RuntimeError(
            "Install: pip install google-api-python-client google-auth google-auth-oauthlib"
        ) from e
    return (
        service_account,
        Credentials,
        InstalledAppFlow,
        Request,
        build,
        MediaFileUpload,
    )


def check_target_folder_uploadable(service, folder_id: str) -> dict[str, Any]:
    """
    Service accounts cannot upload into personal My Drive (Gmail) folders.
    Uploads must target a Google Shared Drive (Team Drive) or domain-delegated user.
    """
    meta = (
        service.files()
        .get(
            fileId=folder_id,
            fields="id,name,driveId,capabilities",
            supportsAllDrives=True,
        )
        .execute()
    )
    if meta.get("driveId"):
        return {"ok": True, "mode": "shared_drive", "drive_id": meta["driveId"]}
    caps = meta.get("capabilities") or {}
    if not caps.get("canAddChildren"):
        return {
            "ok": False,
            "error": "Service account lacks permission to add files to YogaDataset.",
        }
    return {
        "ok": False,
        "error": (
            "YogaDataset is on a personal Google Drive folder. Google does not allow "
            "service-account uploads there (storageQuotaExceeded). Move YogaDataset to a "
            "Google Shared Drive (Team Drive), add the service account as Content manager, "
            "set YOGA_DATASET_FOLDER_ID to that folder, and optionally YOGA_GDRIVE_SHARED_DRIVE_ID."
        ),
        "hint": "shared_drive_required",
    }


def get_drive_service():
    """Service account first (gdrive_service_account.json), then legacy paths."""
    (
        service_account,
        Credentials,
        InstalledAppFlow,
        Request,
        build,
        _MediaFileUpload,
    ) = _load_google_deps()

    env_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    candidates = [
        Path(env_path) if env_path else None,
        DEFAULT_CREDENTIALS,
        LEGACY_CREDENTIALS,
    ]
    sa_path = next((p for p in candidates if p and p.is_file()), None)

    token_path = BACKEND_DIR / "gdrive_token.json"
    oauth_client = BACKEND_DIR / "gdrive_oauth_client.json"

    creds = None
    if sa_path is not None:
        creds = service_account.Credentials.from_service_account_file(
            str(sa_path), scopes=SCOPES
        )
    elif token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
    elif oauth_client.exists():
        flow = InstalledAppFlow.from_client_secrets_file(str(oauth_client), SCOPES)
        creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json(), encoding="utf-8")
    else:
        raise FileNotFoundError(
            f"No Google credentials found. Place service account at {DEFAULT_CREDENTIALS}"
        )

    return build("drive", "v3", credentials=creds, cache_discovery=False)


def load_sync_state() -> dict[str, Any]:
    if not SYNC_STATE_PATH.exists():
        return {"files": {}, "roots": {}}
    try:
        data = json.loads(SYNC_STATE_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return {"files": {}, "roots": {}}
        data.setdefault("files", {})
        data.setdefault("roots", {})
        return data
    except json.JSONDecodeError:
        return {"files": {}, "roots": {}}


def save_sync_state(state: dict[str, Any]) -> None:
    SYNC_STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")


def file_signature(path: Path) -> dict[str, Any]:
    stat = path.stat()
    sig: dict[str, Any] = {
        "size": stat.st_size,
        "mtime": round(stat.st_mtime, 6),
    }
    if stat.st_size <= HASH_MAX_BYTES:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        sig["sha256"] = h.hexdigest()
    return sig


def signatures_match(local: dict[str, Any], stored: dict[str, Any] | None) -> bool:
    if not stored:
        return False
    if local.get("size") != stored.get("size"):
        return False
    if abs(float(local.get("mtime", 0)) - float(stored.get("mtime", 0))) > 0.001:
        return False
    local_hash = local.get("sha256")
    stored_hash = stored.get("sha256")
    if local_hash and stored_hash:
        return local_hash == stored_hash
    if local_hash or stored_hash:
        return False
    return True


def _list_child_folders(service, parent_id: str) -> dict[str, str]:
    q = (
        f"'{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' "
        "and trashed=false"
    )
    out: dict[str, str] = {}
    page_token = None
    while True:
        resp = (
            service.files()
            .list(
                q=q,
                fields="nextPageToken, files(id, name)",
                pageSize=200,
                pageToken=page_token,
                **_DRIVE_LIST_KW,
            )
            .execute()
        )
        for item in resp.get("files", []):
            out[item["name"]] = item["id"]
        page_token = resp.get("nextPageToken")
        if not page_token:
            break
    return out


def ensure_drive_folder(service, parent_id: str, name: str, cache: dict[tuple[str, str], str]) -> str:
    key = (parent_id, name)
    if key in cache:
        return cache[key]
    children = _list_child_folders(service, parent_id)
    if name in children:
        folder_id = children[name]
    else:
        meta = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        folder_id = (
            service.files()
            .create(body=meta, fields="id", **_DRIVE_WRITE_KW)
            .execute()["id"]
        )
    cache[key] = folder_id
    return folder_id


def ensure_drive_path(
    service,
    parent_id: str,
    parts: list[str],
    cache: dict[tuple[str, str], str],
) -> str:
    current = parent_id
    for part in parts:
        if not part or part in (".", ".."):
            continue
        current = ensure_drive_folder(service, current, part, cache)
    return current


def _find_remote_file(service, parent_id: str, name: str) -> dict[str, Any] | None:
    safe_name = name.replace("'", "\\'")
    q = (
        f"'{parent_id}' in parents and name='{safe_name}' and trashed=false"
    )
    resp = (
        service.files()
        .list(
            q=q,
            fields="files(id, name, md5Checksum, modifiedTime, size)",
            pageSize=1,
            **_DRIVE_LIST_KW,
        )
        .execute()
    )
    files = resp.get("files", [])
    return files[0] if files else None


def upload_file_to_drive(
    service,
    local_path: Path,
    parent_id: str,
    *,
    existing_file_id: str | None = None,
) -> str:
    from googleapiclient.http import MediaFileUpload

    mime, _ = mimetypes.guess_type(str(local_path))
    media = MediaFileUpload(
        str(local_path),
        mimetype=mime or "application/octet-stream",
        resumable=True,
    )
    if existing_file_id:
        updated = (
            service.files()
            .update(
                fileId=existing_file_id,
                media_body=media,
                fields="id",
                **_DRIVE_WRITE_KW,
            )
            .execute()
        )
        return updated["id"]
    meta: dict[str, Any] = {"name": local_path.name, "parents": [parent_id]}
    if GDRIVE_SHARED_DRIVE_ID:
        meta["driveId"] = GDRIVE_SHARED_DRIVE_ID
    created = (
        service.files()
        .create(body=meta, media_body=media, fields="id", **_DRIVE_WRITE_KW)
        .execute()
    )
    return created["id"]


def iter_local_files(root: Path):
    if not root.is_dir():
        return
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        if path.name.startswith("."):
            continue
        if path.name in SKIP_FILE_NAMES:
            continue
        rel = path.relative_to(root)
        if any(part in SKIP_DIR_NAMES for part in rel.parts):
            continue
        yield path, rel.as_posix()


def sync_yoga_dataset_root(
    service,
    local_root: Path,
    *,
    drive_parent_id: str,
    state: dict[str, Any],
    folder_cache: dict[tuple[str, str], str],
) -> dict[str, int]:
    stats = {"uploaded": 0, "skipped": 0, "failed": 0}
    root_key = str(local_root)

    if not local_root.is_dir():
        logger.warning("YogaDataset root not found: %s", local_root)
        return stats

    for local_path, rel_posix in iter_local_files(local_root):
        state_key = f"{root_key}|{rel_posix}"
        try:
            sig = file_signature(local_path)
            stored = state["files"].get(state_key)
            if signatures_match(sig, stored) and stored.get("drive_file_id"):
                stats["skipped"] += 1
                continue

            rel_parts = rel_posix.split("/")
            parent_parts, file_name = rel_parts[:-1], rel_parts[-1]
            drive_folder_id = ensure_drive_path(
                service, drive_parent_id, parent_parts, folder_cache
            )

            remote = _find_remote_file(service, drive_folder_id, file_name)
            remote_id = remote["id"] if remote else stored.get("drive_file_id") if stored else None

            file_id = upload_file_to_drive(
                service,
                local_path,
                drive_folder_id,
                existing_file_id=remote_id,
            )
            state["files"][state_key] = {
                **sig,
                "drive_file_id": file_id,
                "rel_path": rel_posix,
                "root": root_key,
                "synced_at": _utc_now_iso(),
            }
            stats["uploaded"] += 1
        except Exception as exc:
            stats["failed"] += 1
            logger.exception("Failed to sync %s: %s", rel_posix, exc)
            errors = state.setdefault("recent_errors", [])
            errors.append(
                {"path": rel_posix, "error": str(exc), "at": _utc_now_iso()}
            )
            state["recent_errors"] = errors[-50:]

    state.setdefault("roots", {})[root_key] = {
        "last_sync_at": _utc_now_iso(),
        "uploaded": stats["uploaded"],
        "skipped": stats["skipped"],
        "failed": stats["failed"],
    }
    return stats


def run_incremental_sync(
    *,
    drive_parent_id: str | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    """
    Sync all configured YogaDataset roots to Google Drive.
    Thread-safe; safe to call from background threads.
    """
    parent_id = drive_parent_id or GDRIVE_PARENT_FOLDER_ID
    if not parent_id:
        return {"ok": False, "error": "YOGA_DATASET_FOLDER_ID not configured"}

    with _sync_lock:
        if _runtime_status.get("running"):
            return {"ok": False, "error": "sync_already_running"}
        _runtime_status["running"] = True
        _runtime_status["last_sync_started"] = _utc_now_iso()

    result: dict[str, Any] = {
        "ok": True,
        "started_at": _runtime_status["last_sync_started"],
        "roots": [],
        "uploaded": 0,
        "skipped": 0,
        "failed": 0,
        "dry_run": dry_run,
    }

    try:
        roots = resolve_dataset_roots()
        _runtime_status["last_roots"] = [str(r) for r in roots]
        if not roots:
            result["ok"] = False
            result["error"] = "no_dataset_roots_available"
            _runtime_status["last_error"] = result["error"]
            return result

        if dry_run:
            pending = 0
            for root in roots:
                pending += sum(1 for _ in iter_local_files(root))
            result["pending_files"] = pending
            return result

        service = get_drive_service()
        upload_check = check_target_folder_uploadable(service, parent_id)
        if not upload_check.get("ok"):
            result["ok"] = False
            result["error"] = upload_check.get("error")
            result["hint"] = upload_check.get("hint")
            _runtime_status["last_error"] = result["error"]
            return result

        state = load_sync_state()
        folder_cache: dict[tuple[str, str], str] = {}

        for root in roots:
            root_stats = sync_yoga_dataset_root(
                service,
                root,
                drive_parent_id=parent_id,
                state=state,
                folder_cache=folder_cache,
            )
            result["roots"].append({"path": str(root), **root_stats})
            result["uploaded"] += root_stats["uploaded"]
            result["skipped"] += root_stats["skipped"]
            result["failed"] += root_stats["failed"]

        state["last_sync_completed"] = _utc_now_iso()
        state["last_sync_success"] = _utc_now_iso() if result["failed"] == 0 else state.get(
            "last_sync_success"
        )
        save_sync_state(state)

        _runtime_status["files_uploaded"] = result["uploaded"]
        _runtime_status["files_skipped"] = result["skipped"]
        _runtime_status["files_failed"] = result["failed"]
        _runtime_status["last_sync_completed"] = _utc_now_iso()
        if result["failed"] == 0:
            _runtime_status["last_sync_success"] = _runtime_status["last_sync_completed"]
            _runtime_status["last_error"] = None
        else:
            _runtime_status["last_error"] = f"{result['failed']} file(s) failed"

        result["completed_at"] = _runtime_status["last_sync_completed"]
        return result
    except Exception as exc:
        logger.exception("Google Drive sync failed")
        _runtime_status["last_error"] = str(exc)
        return {"ok": False, "error": str(exc)}
    finally:
        with _sync_lock:
            _runtime_status["running"] = False


def get_sync_status() -> dict[str, Any]:
    state = load_sync_state()
    cfg = read_dataset_sync_config()
    pending = 0
    for root in resolve_dataset_roots():
        for local_path, rel_posix in iter_local_files(root):
            state_key = f"{root}|{rel_posix}"
            sig = file_signature(local_path)
            if not signatures_match(sig, state["files"].get(state_key)):
                pending += 1

    upload_hint = None
    try:
        service = get_drive_service()
        upload_hint = check_target_folder_uploadable(service, GDRIVE_PARENT_FOLDER_ID)
    except Exception as exc:
        upload_hint = {"ok": False, "error": str(exc)}

    return {
        "running": _runtime_status.get("running", False),
        "drive_folder_id": GDRIVE_PARENT_FOLDER_ID,
        "upload_target_check": upload_hint,
        "configured_dataset_root": cfg.get("dataset_root") if cfg else None,
        "storage_location": cfg.get("storage_location") if cfg else None,
        "last_sync_started": _runtime_status.get("last_sync_started")
        or state.get("last_sync_started"),
        "last_sync_completed": _runtime_status.get("last_sync_completed")
        or state.get("last_sync_completed"),
        "last_sync_success": _runtime_status.get("last_sync_success")
        or state.get("last_sync_success"),
        "files_uploaded_last_run": _runtime_status.get("files_uploaded", 0),
        "files_skipped_last_run": _runtime_status.get("files_skipped", 0),
        "files_failed_last_run": _runtime_status.get("files_failed", 0),
        "pending_uploads_estimate": pending,
        "last_error": _runtime_status.get("last_error"),
        "last_roots": _runtime_status.get("last_roots", []),
        "recent_errors": state.get("recent_errors", [])[-10:],
        "state_file": str(SYNC_STATE_PATH),
        "config_file": str(SYNC_CONFIG_PATH),
    }


def schedule_background_sync() -> None:
    """Fire-and-forget sync (does not block callers)."""

    def _worker() -> None:
        try:
            run_incremental_sync()
        except Exception:
            logger.exception("Background Google Drive sync failed")

    threading.Thread(target=_worker, daemon=True, name="gdrive-sync-once").start()


def run_sync_loop(interval_sec: int = 300) -> None:
    """Run sync every `interval_sec` seconds until interrupted."""
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logger.info(
        "YogaDataset → Google Drive sync every %ss (folder %s)",
        interval_sec,
        GDRIVE_PARENT_FOLDER_ID,
    )
    while True:
        try:
            result = run_incremental_sync()
            logger.info("Sync cycle: %s", json.dumps(result, default=str))
        except Exception:
            logger.exception("Sync loop error")
        time.sleep(interval_sec)
