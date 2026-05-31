import CONFIG from "../config";
import { uploadSessionWebm } from "./sessionRecorderApi";

let mediaRecorder = null;
let recordedChunks = [];
let tZero = null;

function getRecorderMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];
  if (typeof MediaRecorder === "undefined") {
    return "video/webm";
  }
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "video/webm";
}

/**
 * Wait until the camera stream and video element are delivering frames so
 * MediaRecorder does not encode layout reflow / black startup frames.
 */
function waitForCaptureReady(videoElement, stream) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const maxWait = window.setTimeout(done, 800);

    const hasVideoFrame =
      videoElement &&
      videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
      videoElement.videoWidth > 0 &&
      videoElement.videoHeight > 0;

    const track = stream?.getVideoTracks?.()?.[0];
    const trackLive = track && track.readyState === "live" && track.enabled;

    const afterFrames = () => {
      window.clearTimeout(maxWait);
      done();
    };

    const waitPaintedFrames = () => {
      if (!videoElement?.requestVideoFrameCallback) {
        requestAnimationFrame(() => {
          requestAnimationFrame(afterFrames);
        });
        return;
      }
      videoElement.requestVideoFrameCallback(() => {
        videoElement.requestVideoFrameCallback(afterFrames);
      });
    };

    if (hasVideoFrame && trackLive) {
      waitPaintedFrames();
      return;
    }

    if (!videoElement) {
      if (trackLive) {
        window.clearTimeout(maxWait);
        done();
      }
      return;
    }

    const onProgress = () => {
      if (
        videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        videoElement.videoWidth > 0
      ) {
        videoElement.removeEventListener("loadeddata", onProgress);
        videoElement.removeEventListener("playing", onProgress);
        waitPaintedFrames();
      }
    };

    videoElement.addEventListener("loadeddata", onProgress);
    videoElement.addEventListener("playing", onProgress);
    void videoElement.play().catch(() => {});
  });
}

/**
 * @param {MediaStream} stream
 * @param {{ sessionTZero?: number | null, videoElement?: HTMLVideoElement | null }} [options]
 */
function shouldPersistOffline(options) {
  if (options.persistOffline === false) return false;
  if (options.persistOffline === true) return true;
  return Boolean(CONFIG.USE_OFFLINE_SESSION_RECORDER);
}

export async function startRecording(stream, options = {}) {
  const { sessionTZero, videoElement } = options;
  const persistOffline = shouldPersistOffline(options);

  if (!stream || typeof MediaRecorder === "undefined") {
    tZero = Date.now();
    return tZero;
  }

  await waitForCaptureReady(videoElement ?? null, stream);

  tZero = Date.now();
  recordedChunks = [];

  mediaRecorder = new MediaRecorder(stream, {
    mimeType: getRecorderMimeType(),
  });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.start(250);

  if (sessionTZero != null) {
    tZero = sessionTZero;
  }

  return tZero;
}

function waitForRecorderStop(recorder) {
  return new Promise((resolve) => {
    recorder.onstop = () => resolve();
  });
}

function flushFinalChunk(recorder) {
  return new Promise((resolve) => {
    if (typeof recorder.requestData !== "function") {
      resolve();
      return;
    }
    const onData = (e) => {
      if (e.data && e.data.size > 0) {
        recordedChunks.push(e.data);
      }
      resolve();
    };
    recorder.addEventListener("dataavailable", onData, { once: true });
    try {
      recorder.requestData();
    } catch {
      resolve();
    }
  });
}

export function stopRecording(options = {}) {
  return new Promise((resolve) => {
    const finish = async () => {
      const mimeType = getRecorderMimeType();
      const videoBlob = new Blob(recordedChunks, { type: mimeType });
      recordedChunks = [];
      mediaRecorder = null;

      let uploadError = null;
      const persistOffline = shouldPersistOffline(options);
      if (persistOffline && videoBlob.size > 0) {
        try {
          await uploadSessionWebm(videoBlob, {
            poseId: options.poseId,
            poseName: options.poseName,
          });
        } catch (err) {
          uploadError = err;
          console.error("Failed to upload WebM to session folder:", err);
        }
      }

      resolve({
        videoBlob,
        imuPackets: [],
        tZero,
        storedOffline: persistOffline,
        videoUploadOk: uploadError == null,
        videoUploadError: uploadError?.message || null,
      });
    };

    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      void finish();
      return;
    }

    const recorder = mediaRecorder;
    const stopped = waitForRecorderStop(recorder);

    (async () => {
      try {
        if (recorder.state === "recording") {
          await flushFinalChunk(recorder);
        }
      } catch (err) {
        console.warn("Could not flush final recorder chunk:", err);
      }
      try {
        recorder.stop();
      } catch {
        void finish();
        return;
      }
      await stopped;
      await finish();
    })();
  });
}

export function getTZero() {
  return tZero;
}
