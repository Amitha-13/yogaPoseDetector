"""
Incremental Google Drive sync for local YogaDataset folders.

Mirrors {D|E}:\\YogaDataset\\** under Google Drive (OAuth 2.0 user credentials).
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
LOG_DIR = BACKEND_DIR / "logs"
SYNC_LOG_PATH = LOG_DIR / "gdrive_sync.log"


def _configure_file_logger() -> logging.Logger:
    """Dedicated log file for sync diagnostics (backend/logs/gdrive_sync.log)."""
    file_logger = logging.getLogger("yoga.gdrive_sync.file")
    if file_logger.handlers:
        return file_logger
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(SYNC_LOG_PATH, encoding="utf-8")
    handler.setFormatter(
        logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")
    )
    file_logger.addHandler(handler)
    file_logger.setLevel(logging.DEBUG)
    file_logger.propagate = False
    return file_logger


sync_log = _configure_file_logger()

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


def _load_google_build():
    try:
        from googleapiclient.discovery import build
        from googleapiclient.http import MediaFileUpload
    except ImportError as e:
        raise RuntimeError(
            "Install: pip install google-api-python-client google-auth google-auth-oauthlib"
        ) from e
    return build, MediaFileUpload


def check_target_folder_uploadable(service, folder_id: str) -> dict[str, Any]:
    """Verify the YogaDataset destination folder exists and accepts new files."""
    meta = (
        service.files()
        .get(
            fileId=folder_id,
            fields="id,name,driveId,capabilities",
            supportsAllDrives=True,
        )
        .execute()
    )
    caps = meta.get("capabilities") or {}
    if not caps.get("canAddChildren"):
        return {
            "ok": False,
            "error": (
                "Cannot add files to the YogaDataset folder. "
                "Sign in with the Google account that owns this folder."
            ),
        }
    mode = "shared_drive" if meta.get("driveId") else "my_drive"
    return {
        "ok": True,
        "mode": mode,
        "drive_id": meta.get("driveId"),
        "folder_name": meta.get("name"),
        "folder_id": meta.get("id"),
    }


def get_drive_service():
    """Google Drive API client using OAuth user credentials (gdrive_token.json)."""
    from gdrive_oauth import get_oauth_credentials

    build, _MediaFileUpload = _load_google_build()
    creds = get_oauth_credentials(allow_interactive=False)
    sync_log.debug("drive service using oauth credentials valid=%s", creds.valid)
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
        sync_log.debug("folder exists name=%s parent_id=%s folder_id=%s", name, parent_id, folder_id)
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
        sync_log.info(
            "folder created name=%s parent_id=%s folder_id=%s",
            name,
            parent_id,
            folder_id,
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
                sync_log.info(
                    "skipped unchanged local=%s drive_rel=%s size=%s",
                    local_path,
                    rel_posix,
                    sig.get("size"),
                )
                continue

            rel_parts = rel_posix.split("/")
            parent_parts, file_name = rel_parts[:-1], rel_parts[-1]
            drive_dest = "/".join(parent_parts + [file_name]) if parent_parts else file_name
            drive_folder_id = ensure_drive_path(
                service, drive_parent_id, parent_parts, folder_cache
            )

            remote = _find_remote_file(service, drive_folder_id, file_name)
            remote_id = remote["id"] if remote else stored.get("drive_file_id") if stored else None

            sync_log.info(
                "upload start local=%s drive_dest=%s parent_folder_id=%s update=%s",
                local_path,
                drive_dest,
                drive_folder_id,
                bool(remote_id),
            )
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
            sync_log.info(
                "upload success local=%s drive_dest=%s file_id=%s",
                local_path,
                drive_dest,
                file_id,
            )
        except Exception as exc:
            stats["failed"] += 1
            logger.exception("Failed to sync %s: %s", rel_posix, exc)
            sync_log.error(
                "upload failure local=%s drive_rel=%s error=%s",
                local_path,
                rel_posix,
                exc,
            )
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


def derive_gdrive_sync_state(
    *,
    pending: int,
    upload_target_check: dict[str, Any] | None,
) -> tuple[str, str]:
    """UI-friendly sync phase: pending | syncing | synced | failed."""
    if _runtime_status.get("running"):
        return "syncing", "Background sync in progress."

    if upload_target_check is not None and not upload_target_check.get("ok"):
        return "failed", str(
            upload_target_check.get("error") or "Google Drive target not uploadable."
        )

    last_error = _runtime_status.get("last_error")
    failed_last = int(_runtime_status.get("files_failed_last_run") or 0)
    if last_error and (pending > 0 or failed_last > 0):
        return "failed", str(last_error)

    if pending > 0:
        if _runtime_status.get("last_sync_completed"):
            return "pending", f"{pending} file(s) waiting for next sync cycle."
        return "pending", "Waiting for background sync."

    if _runtime_status.get("last_sync_success"):
        return "synced", "Local YogaDataset matches last successful sync."

    if _runtime_status.get("last_sync_completed"):
        return "synced", "Sync cycle completed."

    return "pending", "Waiting for background sync."


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

    cycle_started = time.perf_counter()
    sync_log.info(
        "sync start dry_run=%s drive_folder_id=%s",
        dry_run,
        parent_id,
    )

    sync_acquired = False
    with _sync_lock:
        if _runtime_status.get("running"):
            sync_log.warning("sync skipped reason=sync_already_running")
            return {"ok": False, "error": "sync_already_running"}
        _runtime_status["running"] = True
        _runtime_status["last_sync_started"] = _utc_now_iso()
        sync_acquired = True

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
        sync_log.info("sync roots resolved count=%s paths=%s", len(roots), [str(r) for r in roots])
        if not roots:
            result["ok"] = False
            result["error"] = "no_dataset_roots_available"
            _runtime_status["last_error"] = result["error"]
            sync_log.error("sync finish error=no_dataset_roots_available")
            return result

        if dry_run:
            pending = 0
            for root in roots:
                pending += sum(1 for _ in iter_local_files(root))
            result["pending_files"] = pending
            sync_log.info("sync dry_run finish pending_files=%s", pending)
            return result

        service = get_drive_service()
        upload_check = check_target_folder_uploadable(service, parent_id)
        sync_log.info("upload target check result=%s", json.dumps(upload_check, default=str))
        if not upload_check.get("ok"):
            result["ok"] = False
            result["error"] = upload_check.get("error")
            result["hint"] = upload_check.get("hint")
            _runtime_status["last_error"] = result["error"]
            sync_log.error("sync aborted upload_check failed error=%s", result["error"])
            return result

        state = load_sync_state()
        folder_cache: dict[tuple[str, str], str] = {}

        for root in roots:
            sync_log.info("sync root start path=%s", root)
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
            sync_log.info(
                "sync root finish path=%s uploaded=%s skipped=%s failed=%s",
                root,
                root_stats["uploaded"],
                root_stats["skipped"],
                root_stats["failed"],
            )

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
        elapsed = time.perf_counter() - cycle_started
        sync_log.info(
            "sync finish ok=%s uploaded=%s skipped=%s failed=%s duration_sec=%.2f",
            result.get("ok"),
            result.get("uploaded"),
            result.get("skipped"),
            result.get("failed"),
            elapsed,
        )
        return result
    except Exception as exc:
        logger.exception("Google Drive sync failed")
        sync_log.exception(
            "sync finish error=%s duration_sec=%.2f",
            exc,
            time.perf_counter() - cycle_started,
        )
        _runtime_status["last_error"] = str(exc)
        return {"ok": False, "error": str(exc)}
    finally:
        if sync_acquired:
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

    from gdrive_oauth import oauth_status

    oauth_info = oauth_status()
    upload_hint = None
    if oauth_info.get("oauth_token_present"):
        try:
            service = get_drive_service()
            upload_hint = check_target_folder_uploadable(service, GDRIVE_PARENT_FOLDER_ID)
        except Exception as exc:
            upload_hint = {"ok": False, "error": str(exc), "hint": "oauth_reauthorize"}
    else:
        upload_hint = {
            "ok": False,
            "error": "OAuth token missing. Run: python setup_gdrive_oauth.py",
            "hint": "oauth_required",
        }

    gdrive_state, gdrive_detail = derive_gdrive_sync_state(
        pending=pending,
        upload_target_check=upload_hint,
    )

    if not oauth_info.get("oauth_token_valid") and oauth_info.get("oauth_token_present"):
        gdrive_state, gdrive_detail = "failed", (
            "OAuth token invalid. Run: python setup_gdrive_oauth.py"
        )
    elif upload_hint and upload_hint.get("hint") == "oauth_required":
        gdrive_state, gdrive_detail = "failed", upload_hint.get("error", gdrive_detail)

    return {
        "running": _runtime_status.get("running", False),
        "gdrive_sync_state": gdrive_state,
        "gdrive_sync_detail": gdrive_detail,
        "drive_folder_id": GDRIVE_PARENT_FOLDER_ID,
        "drive_folder_name": "YogaDataset",
        "upload_target_check": upload_hint,
        **oauth_info,
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
        "log_file": str(SYNC_LOG_PATH),
        "state_file": str(SYNC_STATE_PATH),
        "config_file": str(SYNC_CONFIG_PATH),
    }


def schedule_background_sync() -> None:
    """Fire-and-forget sync (does not block callers)."""
    from gdrive_oauth import OAUTH_TOKEN_FILE

    if not OAUTH_TOKEN_FILE.is_file():
        sync_log.warning(
            "sync not scheduled: missing gdrive_token.json — run setup_gdrive_oauth.py"
        )
        _runtime_status["last_error"] = (
            "Google Drive OAuth not configured. Run: python setup_gdrive_oauth.py"
        )
        return
    sync_log.info("sync scheduled reason=background_trigger")

    def _worker() -> None:
        try:
            run_incremental_sync()
        except Exception:
            logger.exception("Background Google Drive sync failed")
            sync_log.exception("sync scheduled worker failed")

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
            if not result.get("ok"):
                sync_log.warning(
                    "sync loop retry next_in_sec=%s reason=%s",
                    interval_sec,
                    result.get("error"),
                )
        except Exception:
            logger.exception("Sync loop error")
            sync_log.exception("sync loop error retry next_in_sec=%s", interval_sec)
        time.sleep(interval_sec)
