import CONFIG from "../config";
import { uploadSessionWebm } from "./sessionRecorderApi";

let mediaRecorder = null;
let recordedChunks = [];
let tZero = null;

function getRecorderMimeType() {
  const preferred = "video/webm;codecs=vp8,opus";
  if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(preferred)) {
    return preferred;
  }
  return "video/webm";
}

/**
 * @param {MediaStream} stream
 * @param {{ sessionTZero?: number | null, videoElement?: HTMLVideoElement | null }} [options]
 */
export function startRecording(stream, options = {}) {
  const { sessionTZero } = options;
  tZero = Date.now();
  recordedChunks = [];

  mediaRecorder = new MediaRecorder(stream, {
    mimeType: getRecorderMimeType(),
  });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.start(100);

  if (sessionTZero != null) {
    tZero = sessionTZero;
  }

  return tZero;
}

export function stopRecording(options = {}) {
  return new Promise((resolve) => {
    const finish = async () => {
      const videoBlob = new Blob(recordedChunks, { type: "video/webm" });
      recordedChunks = [];
      mediaRecorder = null;

      if (CONFIG.USE_OFFLINE_SESSION_RECORDER && videoBlob.size > 0) {
        try {
          await uploadSessionWebm(videoBlob, {
            poseId: options.poseId,
            poseName: options.poseName,
          });
        } catch (err) {
          console.error("Failed to upload WebM to session folder:", err);
        }
      }

      resolve({
        videoBlob,
        imuPackets: [],
        tZero,
        storedOffline: CONFIG.USE_OFFLINE_SESSION_RECORDER,
      });
    };

    if (!mediaRecorder) {
      void finish();
      return;
    }

    mediaRecorder.onstop = () => {
      void finish();
    };
    mediaRecorder.stop();
  });
}

export function getTZero() {
  return tZero;
}
