#!/usr/bin/env python3
"""
One-time Google Drive OAuth authorization for YogaDataset sync.

Creates or refreshes backend/gdrive_token.json using backend/gdrive_oauth_client.json.

Usage (from backend directory):
  python setup_gdrive_oauth.py
"""

from __future__ import annotations

import sys

from gdrive_oauth import OAUTH_TOKEN_FILE, authorize_oauth, resolve_oauth_client_path
from gdrive_sync import GDRIVE_PARENT_FOLDER_ID, check_target_folder_uploadable


def main() -> None:
    print("\n=== Google Drive OAuth Setup ===\n")
    try:
        client = resolve_oauth_client_path()
        print(f"OAuth client: {client}\n")
    except FileNotFoundError as e:
        print(e, file=sys.stderr)
        raise SystemExit(1) from e

    print("A browser window will open. Sign in with the Google account that owns")
    print("the YogaDataset folder, then allow access.\n")

    creds = authorize_oauth()
    print(f"\nToken saved: {OAUTH_TOKEN_FILE}\n")

    from googleapiclient.discovery import build

    service = build("drive", "v3", credentials=creds, cache_discovery=False)
    check = check_target_folder_uploadable(service, GDRIVE_PARENT_FOLDER_ID)
    if check.get("ok"):
        print("YogaDataset folder check: OK")
        print(f"  Name: {check.get('folder_name')}")
        print(f"  Mode: {check.get('mode')}")
        print(f"  ID:   {GDRIVE_PARENT_FOLDER_ID}\n")
        print("You can now run background sync:")
        print("  python yoga_dataset_gdrive_sync.py --once\n")
    else:
        print("Warning: folder check failed:", check.get("error"), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
