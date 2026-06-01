from gdrive_sync import get_drive_service

FOLDER_ID = "1KyRLCML879M7x5LZic1s3ozYtH7Bfvo8"

service = get_drive_service()

result = (
    service.files()
    .get(
        fileId=FOLDER_ID,
        fields="id,name,driveId,owners",
        supportsAllDrives=True,
    )
    .execute()
)

print(result)