from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = ["https://www.googleapis.com/auth/drive"]

BASE_DIR = Path(__file__).resolve().parent
CREDENTIALS_FILE = BASE_DIR / "gdrive_service_account.json"

FOLDER_ID = "1KyRLCML879M7x5LZic1s3ozYtH7Bfvo8"


def main():
    print("\n=== Google Drive Connection Test ===\n")

    if not CREDENTIALS_FILE.exists():
        print(f"Credentials file not found: {CREDENTIALS_FILE}")
        return

    creds = service_account.Credentials.from_service_account_file(
        str(CREDENTIALS_FILE),
        scopes=SCOPES,
    )

    service = build("drive", "v3", credentials=creds)

    try:
        folder = (
            service.files()
            .get(
                fileId=FOLDER_ID,
                fields="id,name,mimeType"
            )
            .execute()
        )

        print("Connection successful.\n")

        print(f"Folder Name : {folder['name']}")
        print(f"Folder ID   : {folder['id']}")
        print(f"Type        : {folder['mimeType']}")

        print("\nService account can access YogaDataset.\n")

    except Exception as e:
        print("\nConnection failed.\n")
        print(str(e))


if __name__ == "__main__":
    main()