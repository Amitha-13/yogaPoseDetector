import JSZip from "jszip";
import CONFIG from "../config";
import { buildFileNames } from "./sessionNaming";
import { buildLandmarksExportDocument } from "./landmarkExport";

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

  if (
    !recording.storedOffline &&
    recording.videoBlob &&
    recording.videoBlob.size > 0
  ) {
    zip.file(names.video, recording.videoBlob);
  }

  const imuPackets = recording.imuPackets || [];

  function devicesFromFrame(frame) {
    return frame.devices && typeof frame.devices === "object" ? frame.devices : {};
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
            CONFIG.PLACEHOLDER_SENSOR_COUNT ??
            CONFIG.TOTAL_SENSOR_COUNT - CONFIG.ACTIVE_SENSOR_COUNT,
          slots: CONFIG.SENSOR_SLOTS.map((slot) => ({
            id: slot.id,
            bodyPart: slot.bodyPart,
            status: slot.status,
            hasData:
              recording.sensorConfig?.connectedDuring?.includes(slot.id) ?? false,
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
          devices: devicesFromFrame(frame),
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

  const landmarksDoc = buildLandmarksExportDocument(recording.landmarks || [], {
    videoFps: CONFIG.VIDEO_STREAM_FPS,
  });
  zip.file(
    names.landmarks,
    JSON.stringify(
      {
        participantId,
        poseName: recording.poseName,
        poseId: recording.poseId,
        recordedAt: recording.recordedAt,
        ...landmarksDoc,
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

/**
 * @param {object[]} sessionRecordings
 * @param {object} metadata
 * @param {string} participantId
 */
export async function saveSessionLocally(sessionRecordings, metadata, participantId) {
  try {
    const dirHandle = await window.showDirectoryPicker({
      mode: "readwrite",
      startIn: "downloads",
    });

    const sessionDate = new Date().toISOString().split("T")[0];
    const folderName = `${participantId}_${sessionDate}_Session`;
    const participantDir = await dirHandle.getDirectoryHandle(folderName, { create: true });

    const results = [];

    for (const recording of sessionRecordings) {
      if (recording.skipped) {
        results.push({
          poseName: recording.poseName,
          status: "skipped",
        });
        continue;
      }

      try {
        const { zipBlob, zipFileName } = await createSessionZip(
          recording,
          metadata,
          participantId
        );

        const fileHandle = await participantDir.getFileHandle(zipFileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(zipBlob);
        await writable.close();

        results.push({
          poseName: recording.poseName,
          fileName: zipFileName,
          status: "saved_locally",
          path: `${folderName}/${zipFileName}`,
        });
      } catch (err) {
        results.push({
          poseName: recording.poseName,
          status: "failed",
          error: err?.message || String(err),
        });
      }
    }

    const summary = {
      participantId,
      metadata,
      sessionDate: new Date().toISOString(),
      savedLocally: true,
      poses: sessionRecordings.map((r) => ({
        poseId: r.poseId,
        poseName: r.poseName,
        skipped: r.skipped,
      })),
    };
    const summaryHandle = await participantDir.getFileHandle(
      `${participantId}_session_summary.json`,
      { create: true }
    );
    const summaryWritable = await summaryHandle.createWritable();
    await summaryWritable.write(JSON.stringify(summary, null, 2));
    await summaryWritable.close();

    return {
      success: true,
      folderName,
      results,
    };
  } catch (err) {
    if (err?.name === "AbortError") {
      return { success: false, cancelled: true };
    }
    return {
      success: false,
      error: err?.message || String(err),
    };
  }
}

export { createSessionZip };
