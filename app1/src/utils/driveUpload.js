import JSZip from "jszip";
import CONFIG from "../config";

/**
 * @param {string} name
 * @param {string} parentId
 * @param {string} accessToken
 * @returns {Promise<string>}
 */
async function createDriveFolder(name, parentId, accessToken) {
  const res = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(text || `Drive folder create failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  return data.id;
}

/**
 * @param {Blob} blob
 * @param {string} fileName
 * @param {string} mimeType
 * @param {string} folderId
 * @param {string} accessToken
 * @param {(percent: number) => void} [onProgress]
 * @returns {Promise<{ driveFileId: string, webViewLink: string }>}
 */
function uploadFileToDrive(
  blob,
  fileName,
  mimeType,
  folderId,
  accessToken,
  onProgress
) {
  const boundary = `drive_multipart_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const metadata = JSON.stringify({
    name: fileName,
    parents: [folderId],
  });

  const body = new Blob(
    [
      `--${boundary}\r\n`,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      `${metadata}\r\n`,
      `--${boundary}\r\n`,
      `Content-Type: ${mimeType}\r\n\r\n`,
      blob,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const url =
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink";

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    xhr.setRequestHeader(
      "Content-Type",
      `multipart/related; boundary=${boundary}`
    );

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === "function") {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText || "{}");
          resolve({
            driveFileId: data.id,
            webViewLink: data.webViewLink || "",
          });
        } catch (e) {
          const err = new Error("Invalid Drive response");
          err.status = xhr.status;
          reject(err);
        }
      } else {
        const err = new Error(
          xhr.responseText || `Upload failed (${xhr.status})`
        );
        err.status = xhr.status;
        reject(err);
      }
    };

    xhr.onerror = () => {
      const err = new Error("Network error during upload");
      err.status = xhr.status || 0;
      reject(err);
    };

    xhr.send(body);
  });
}

function sanitizeFilePart(str) {
  return String(str || "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 80) || "pose";
}

/**
 * @param {object} recording
 * @param {object} metadata
 * @param {string} participantId
 * @returns {Promise<{ zipBlob: Blob, zipFileName: string }>}
 */
async function createSessionZip(recording, metadata, participantId) {
  const zip = new JSZip();
  const recDate = recording.recordedAt
    ? new Date(recording.recordedAt)
    : new Date();
  const y = recDate.getFullYear();
  const m = String(recDate.getMonth() + 1).padStart(2, "0");
  const d = String(recDate.getDate()).padStart(2, "0");
  const hh = String(recDate.getHours()).padStart(2, "0");
  const mm = String(recDate.getMinutes()).padStart(2, "0");
  const ss = String(recDate.getSeconds()).padStart(2, "0");
  const ymd = `${y}${m}${d}`;
  const hms = `${hh}${mm}${ss}`;

  const safeName = sanitizeFilePart(recording.poseName);
  const zipFileName = `${participantId}_S01_${recording.poseId}_${safeName}_${ymd}_${hms}.zip`;

  if (recording.videoBlob && recording.videoBlob.size > 0) {
    zip.file("video.webm", recording.videoBlob);
  }

  zip.file(
    "imu_data.json",
    JSON.stringify(
      {
        participantId,
        poseName: recording.poseName,
        poseId: recording.poseId,
        recordedAt: recording.recordedAt,
        packets: recording.imuPackets || [],
      },
      null,
      2
    )
  );

  zip.file(
    "landmarks.json",
    JSON.stringify(
      {
        participantId,
        poseName: recording.poseName,
        poseId: recording.poseId,
        recordedAt: recording.recordedAt,
        totalFrames: recording.landmarks?.length || 0,
        samplingRate: "30fps",
        coordinateSystem: "normalized_0_to_1",
        landmarks: recording.landmarks || [],
      },
      null,
      2
    )
  );

  zip.file(
    "metadata.json",
    JSON.stringify(
      {
        participantId,
        poseName: recording.poseName,
        poseId: recording.poseId,
        sanskrit: recording.sanskrit,
        duration: recording.duration,
        recordedAt: recording.recordedAt,
        skipped: recording.skipped,
        ...metadata,
      },
      null,
      2
    )
  );

  const zipBlob = await zip.generateAsync({ type: "blob" });
  return { zipBlob, zipFileName };
}

function uploadKey(participantId, poseId) {
  return `uploaded_${participantId}_${poseId}`;
}

function sessionFolderLink(id) {
  return `https://drive.google.com/drive/folders/${id}`;
}

/**
 * @param {object[]} sessionRecordings
 * @param {object} metadata
 * @param {string} participantId
 * @param {string} accessToken
 * @param {(poseIndex: number, percent: number, status: string) => void} onProgress
 * @param {{ resume?: { participantFolderId: string, sessionFolderId: string }, onlyIndices?: number[] }} [options]
 * @returns {Promise<{ sessionFolderId: string, sessionFolderLink: string, participantFolderId: string, results: object[] }>}
 */
export async function uploadSession(
  sessionRecordings,
  metadata,
  participantId,
  accessToken,
  onProgress,
  options = {}
) {
  const { resume, onlyIndices } = options;
  const indexFilter =
    onlyIndices != null && onlyIndices.length > 0
      ? new Set(onlyIndices)
      : null;

  const results = [];
  let participantFolderId;
  let sessionFolderId;

  if (resume?.participantFolderId && resume?.sessionFolderId) {
    participantFolderId = resume.participantFolderId;
    sessionFolderId = resume.sessionFolderId;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    participantFolderId = await createDriveFolder(
      participantId,
      CONFIG.YOGA_DATASET_FOLDER_ID,
      accessToken
    );
    sessionFolderId = await createDriveFolder(
      `${today}_Session01`,
      participantFolderId,
      accessToken
    );
  }

  for (let index = 0; index < sessionRecordings.length; index++) {
    if (indexFilter && !indexFilter.has(index)) {
      continue;
    }

    const recording = sessionRecordings[index];

    if (recording.skipped === true) {
      onProgress(index, 100, "skipped");
      results.push({ index, status: "skipped" });
      continue;
    }

    const key = uploadKey(participantId, recording.poseId);
    if (typeof localStorage !== "undefined" && localStorage.getItem(key)) {
      onProgress(index, 100, "already_uploaded");
      results.push({
        index,
        status: "already_uploaded",
        driveFileId: localStorage.getItem(key),
      });
      continue;
    }

    try {
      onProgress(index, 0, "uploading");
      const { zipBlob, zipFileName } = await createSessionZip(
        recording,
        metadata,
        participantId
      );

      const { driveFileId, webViewLink } = await uploadFileToDrive(
        zipBlob,
        zipFileName,
        "application/zip",
        sessionFolderId,
        accessToken,
        (percent) => onProgress(index, percent, "uploading")
      );

      if (typeof localStorage !== "undefined") {
        localStorage.setItem(key, driveFileId);
      }
      onProgress(index, 100, "uploaded");
      results.push({
        index,
        status: "uploaded",
        driveFileId,
        webViewLink,
      });
    } catch (e) {
      onProgress(index, 0, "failed");
      results.push({
        index,
        status: "failed",
        error: e?.message || String(e),
        httpStatus: e?.status,
      });
      if (e?.status === 401) {
        throw e;
      }
    }
  }

  if (!indexFilter) {
    const summary = {
      participantId,
      metadata,
      sessionDate: new Date().toISOString(),
      totalPoses: sessionRecordings.length,
      recorded: sessionRecordings.filter((r) => !r.skipped).length,
      skipped: sessionRecordings.filter((r) => r.skipped).length,
      poses: sessionRecordings.map((r) => ({
        poseId: r.poseId,
        poseName: r.poseName,
        skipped: r.skipped,
        recordedAt: r.recordedAt,
        imuPacketCount: r.imuPackets?.length || 0,
      })),
    };

    const summaryBlob = new Blob([JSON.stringify(summary, null, 2)], {
      type: "application/json",
    });
    const summaryName = `${participantId}_session_summary.json`;

    try {
      await uploadFileToDrive(
        summaryBlob,
        summaryName,
        "application/json",
        sessionFolderId,
        accessToken,
        () => {}
      );
    } catch (summaryErr) {
      if (summaryErr?.status === 401) {
        throw summaryErr;
      }
    }
  }

  return {
    sessionFolderId,
    sessionFolderLink: sessionFolderLink(sessionFolderId),
    participantFolderId,
    results,
  };
}

export { createDriveFolder, uploadFileToDrive, createSessionZip };
