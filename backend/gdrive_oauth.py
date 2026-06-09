"""
Google Drive OAuth 2.0 credentials for YogaDataset background sync.

Uses:
  backend/gdrive_oauth_client.json  (OAuth client secrets from Google Cloud Console)
  backend/gdrive_token.json         (user token; created on first authorization)

Run once per machine:
  python setup_gdrive_oauth.py
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from google.oauth2.credentials import Credentials

BACKEND_DIR = Path(__file__).resolve().parent
OAUTH_CLIENT_FILE = BACKEND_DIR / "gdrive_oauth_client.json"
OAUTH_TOKEN_FILE = BACKEND_DIR / "gdrive_token.json"
OAUTH_CLIENT_ALT = BACKEND_DIR / "gdrive_oauth_client.json.json"

# Full Drive access for mirror sync into user's YogaDataset folder
SCOPES = ["https://www.googleapis.com/auth/drive"]

logger = logging.getLogger(__name__)


def resolve_oauth_client_path() -> Path:
    """Locate OAuth client secrets file (supports common misnamed copy)."""
    if OAUTH_CLIENT_FILE.is_file():
        return OAUTH_CLIENT_FILE
    if OAUTH_CLIENT_ALT.is_file():
        logger.warning(
            "Using %s — rename to gdrive_oauth_client.json when convenient.",
            OAUTH_CLIENT_ALT.name,
        )
        return OAUTH_CLIENT_ALT
    raise FileNotFoundError(
        "OAuth client file not found. Place Google OAuth client JSON at:\n"
        f"  {OAUTH_CLIENT_FILE}\n"
        "(Download from Google Cloud Console → APIs → Credentials → OAuth client ID)"
    )


def _load_deps():
    try:
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
    except ImportError as e:
        raise RuntimeError(
            "Install: pip install google-api-python-client google-auth google-auth-oauthlib"
        ) from e
    return Credentials, InstalledAppFlow, Request


def save_token(creds: "Credentials") -> None:
    OAUTH_TOKEN_FILE.write_text(creds.to_json(), encoding="utf-8")
    logger.info("OAuth token saved to %s", OAUTH_TOKEN_FILE)


def authorize_oauth() -> "Credentials":
    """Open browser, complete OAuth consent, write gdrive_token.json."""
    Credentials, InstalledAppFlow, _Request = _load_deps()
    client_path = resolve_oauth_client_path()
    flow = InstalledAppFlow.from_client_secrets_file(str(client_path), SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent")
    save_token(creds)
    return creds


def get_oauth_credentials(*, allow_interactive: bool = False) -> "Credentials":
    """
    Load OAuth credentials from gdrive_token.json, refreshing access token if expired.

    Background sync must pass allow_interactive=False so the server never opens a browser.
    Use setup_gdrive_oauth.py for first-time authorization.
    """
    Credentials, InstalledAppFlow, Request = _load_deps()

    if OAUTH_TOKEN_FILE.is_file():
        creds = Credentials.from_authorized_user_file(str(OAUTH_TOKEN_FILE), SCOPES)
        if creds.valid:
            return creds
        if creds.expired and creds.refresh_token:
            logger.info("OAuth access token expired; refreshing...")
            creds.refresh(Request())
            save_token(creds)
            logger.info("OAuth access token refreshed")
            return creds
        if allow_interactive:
            return authorize_oauth()
        raise RuntimeError(
            "OAuth token expired or revoked. Re-authorize:\n"
            "  python setup_gdrive_oauth.py"
        )

    if allow_interactive:
        return authorize_oauth()

    raise FileNotFoundError(
        "No OAuth token at backend/gdrive_token.json.\n"
        "Run one-time authorization:\n"
        "  python setup_gdrive_oauth.py"
    )


def oauth_status() -> dict:
    """Lightweight status for sync API (no API calls)."""
    client_path = None
    try:
        client_path = str(resolve_oauth_client_path())
    except FileNotFoundError:
        client_path = None
    token_present = OAUTH_TOKEN_FILE.is_file()
    token_valid = False
    if token_present:
        try:
            creds = get_oauth_credentials(allow_interactive=False)
            token_valid = bool(creds and creds.valid)
        except Exception:
            token_valid = False
    return {
        "auth_mode": "oauth",
        "oauth_client_configured": client_path is not None,
        "oauth_client_path": client_path,
        "oauth_token_present": token_present,
        "oauth_token_valid": token_valid,
        "oauth_token_path": str(OAUTH_TOKEN_FILE),
    }
