import JSZip from "jszip";
import CONFIG from "../config";
import { buildFileNames, sanitizeToken } from "./sessionNaming";
import { writeBlobToDirectory } from "./localYogaFolder";

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

function makeParticipantFolderName(name, participantId) {
  const base = sanitizeToken(name || participantId).toUpperCase();
  const randomSuffix = String(Math.floor(Math.random() * 100000)).padStart(5, "0");
  return `${base}_${randomSuffix}`;
}

/**
 * @param {object} recording
 * @param {object} metadata
 * @param {string} participantId
 * @returns {Promise<{ zipBlob: Blob, zipFileName: string }>}
 */
async function createSessionZip(recording, metadata, participantId) {
  const zip = new JSZip();
  const names = buildFileNames({
    username: metadata?.username || metadata?.name || participantId,
    sessionNumber: metadata?.sessionNumber ?? 1,
    recordedAt: recording.recordedAt || new Date().toISOString(),
    category: recording.category || "general",
    asanaName: recording.poseName,
  });
  const zipFileName = names.zip;

  if (recording.videoBlob && recording.videoBlob.size > 0) {
    zip.file(names.video, recording.videoBlob);
  }

  const imuPackets = recording.imuPackets || [];

  function devicesWithPlaceholders(frame) {
    const live =
      frame.devices && typeof frame.devices === "object" ? frame.devices : {};
    const out = { ...live };
    CONFIG.SENSOR_SLOTS.filter((s) => s.status === "placeholder").forEach(
      (slot) => {
        if (!(slot.id in out)) {
          out[slot.id] = {
            status: "placeholder",
            bodyPart: slot.bodyPart,
            data: null,
            note: "Sensor not yet available. Will be populated in future sessions.",
          };
        }
      }
    );
    return out;
  }

  zip.file(
    names.imu,
    JSON.stringify(
      {
        participantId,
        poseName: recording.poseName,
        poseId: recording.poseId,
        recordedAt: recording.recordedAt,
        imuSource: "BNO08x_real_udp",
        sensor_configuration: {
          total_slots: CONFIG.TOTAL_SENSOR_COUNT,
          active_slots: CONFIG.ACTIVE_SENSOR_COUNT,
          placeholder_slots:
            CONFIG.TOTAL_SENSOR_COUNT - CONFIG.ACTIVE_SENSOR_COUNT,
          slots: CONFIG.SENSOR_SLOTS.map((slot) => ({
            id: slot.id,
            bodyPart: slot.bodyPart,
            status: slot.status,
            hasData:
              recording.sensorConfig?.connectedDuring?.includes(slot.id) ??
              false,
          })),
        },
        sensor_hardware: {
          model: "Adafruit BNO08x",
          reportType: "SH2_ARVR_STABILIZED_RV",
          protocol: "UDP → Flask REST → React fetch",
          fields: {
            qr: "quaternion real",
            qi: "quaternion i",
            qj: "quaternion j",
            qk: "quaternion k",
            voltage: "battery V",
            soc: "battery %",
            rssi: "WiFi dBm",
            relative_timestamp: "ms since tZero",
          },
        },
        frames: imuPackets.map((frame) => ({
          relative_timestamp: frame.relative_timestamp,
          devices: devicesWithPlaceholders(frame),
        })),
      },
      null,
      2
    )
  );

  if (Array.isArray(recording.fsrPackets)) {
    zip.file(
      names.fsr,
      JSON.stringify(
        {
          participantId,
          poseName: recording.poseName,
          poseId: recording.poseId,
          recordedAt: recording.recordedAt,
          packets: recording.fsrPackets,
        },
        null,
        2
      )
    );
  }

  zip.file(
    names.landmarks,
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
    names.metadata,
    JSON.stringify(
      {
        participantId,
        poseName: recording.poseName,
        poseId: recording.poseId,
        sanskrit: recording.sanskrit,
        category: recording.category || "general",
        variation: recording.variation || "",
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
 * @param {{ resume?: { participantFolderId: string, sessionFolderId: string }, onlyIndices?: number[], localYogaDirHandle?: FileSystemDirectoryHandle | null }} [options]
 * @returns {Promise<{ sessionFolderId: string, sessionFolderLink: string, participantFolderId: string, results: object[], localSaveErrors: string[] }>}
 */
export async function uploadSession(
  sessionRecordings,
  metadata,
  participantId,
  accessToken,
  onProgress,
  options = {}
) {
  const { resume, onlyIndices, localYogaDirHandle } = options;
  const localSaveErrors = [];
  const indexFilter =
    onlyIndices != null && onlyIndices.length > 0
      ? new Set(onlyIndices)
      : null;

  const results = [];
  let participantFolderId;
  let sessionFolderId;

  async function saveLocalZip(zipBlob, zipFileName) {
    if (!localYogaDirHandle) return;
    try {
      await writeBlobToDirectory(localYogaDirHandle, zipFileName, zipBlob);
    } catch (e) {
      localSaveErrors.push(`${zipFileName}: ${e?.message || String(e)}`);
    }
  }

  async function saveLocalJson(blob, name) {
    if (!localYogaDirHandle) return;
    try {
      await writeBlobToDirectory(localYogaDirHandle, name, blob);
    } catch (e) {
      localSaveErrors.push(`${name}: ${e?.message || String(e)}`);
    }
  }

  if (resume?.participantFolderId && resume?.sessionFolderId) {
    participantFolderId = resume.participantFolderId;
    sessionFolderId = resume.sessionFolderId;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const participantFolderName = makeParticipantFolderName(metadata?.name, participantId);
    participantFolderId = await createDriveFolder(
      participantFolderName,
      CONFIG.YOGA_DATASET_FOLDER_ID,
      accessToken
    );
    sessionFolderId = await createDriveFolder(
      `${today}_session${String(metadata?.sessionNumber ?? 1).padStart(2, "0")}`,
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

    const key = uploadKey(participantId, `${recording.poseId}_${recording.recordedAt || ""}`);
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

      await saveLocalZip(zipBlob, zipFileName);

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
    const summaryName = buildFileNames({
      username: metadata?.username || metadata?.name || participantId,
      sessionNumber: metadata?.sessionNumber ?? 1,
      recordedAt: new Date().toISOString(),
      category: "all",
      asanaName: "summary",
    }).summary;

    try {
      await saveLocalJson(summaryBlob, summaryName);
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
    localSaveErrors,
  };
}

export { createDriveFolder, uploadFileToDrive, createSessionZip };
