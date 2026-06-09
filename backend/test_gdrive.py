"""Test Google Drive OAuth access to the YogaDataset folder."""

from __future__ import annotations

from gdrive_oauth import oauth_status
from gdrive_sync import GDRIVE_PARENT_FOLDER_ID, check_target_folder_uploadable, get_drive_service


def main() -> None:
    print("\n=== Google Drive OAuth Connection Test ===\n")
    status = oauth_status()
    print("OAuth status:", status)
    if not status.get("oauth_token_present"):
        print("\nNo token found. Run:\n  python setup_gdrive_oauth.py\n")
        return

    service = get_drive_service()
    folder = (
        service.files()
        .get(
            fileId=GDRIVE_PARENT_FOLDER_ID,
            fields="id,name,mimeType,driveId",
            supportsAllDrives=True,
        )
        .execute()
    )
    print("\nFolder read: OK")
    print(f"  Name : {folder['name']}")
    print(f"  ID   : {folder['id']}")
    print(f"  Type : {folder['mimeType']}")

    check = check_target_folder_uploadable(service, GDRIVE_PARENT_FOLDER_ID)
    print(f"\nUpload check: {'OK' if check.get('ok') else 'FAILED'}")
    if check.get("ok"):
        print(f"  Mode: {check.get('mode')}")
    else:
        print(f"  Error: {check.get('error')}")
    print()


if __name__ == "__main__":
    main()
