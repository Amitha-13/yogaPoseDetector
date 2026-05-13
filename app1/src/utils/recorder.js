import CONFIG from "../config";

let mediaRecorder = null;
let recordedChunks = [];
let imuBuffer = [];
let tZero = null;
let pollTimer = null;

async function postSync(sessionTZero) {
  const url = CONFIG.FLASK_SYNC_URL;
  if (!url) return;
  try {
    await fetch(url.replace(/\/$/, ""), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tZero: sessionTZero }),
    });
  } catch {
    /* Flask may be offline */
  }
}

/**
 * @param {MediaStream} stream
 * @param {{ sessionTZero?: number | null }} [options]
 */
export function startRecording(stream, options = {}) {
  const { sessionTZero } = options;
  tZero = Date.now();
  recordedChunks = [];
  imuBuffer = [];

  if (sessionTZero != null) {
    void postSync(sessionTZero);
  }

  mediaRecorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp8,opus",
  });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.start(100);

  const pollMs = Math.max(10, Number(CONFIG.IMU_POLL_MS) || 20);
  const dataUrl = CONFIG.FLASK_DATA_URL?.replace(/\/$/, "");
  if (dataUrl) {
    pollTimer = window.setInterval(async () => {
      try {
        const res = await fetch(dataUrl);
        if (!res.ok) return;
        const data = await res.json();
        imuBuffer.push({
          relative_timestamp: data.relative_timestamp,
          devices: data.devices && typeof data.devices === "object" ? data.devices : {},
        });
      } catch {
        /* ignore poll errors */
      }
    }, pollMs);
  }

  return tZero;
}

export function stopRecording() {
  return new Promise((resolve) => {
    if (pollTimer != null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }

    if (!mediaRecorder) {
      resolve({
        videoBlob: new Blob(recordedChunks, { type: "video/webm" }),
        imuPackets: [...imuBuffer],
        tZero,
      });
      return;
    }

    mediaRecorder.onstop = () => {
      const videoBlob = new Blob(recordedChunks, { type: "video/webm" });
      mediaRecorder = null;
      resolve({
        videoBlob,
        imuPackets: [...imuBuffer],
        tZero,
      });
    };
    mediaRecorder.stop();
  });
}

export function getTZero() {
  return tZero;
}

export function getImuBuffer() {
  return [...imuBuffer];
}
