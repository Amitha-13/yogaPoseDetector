import CONFIG from "../config";

const BASE = (CONFIG.SESSION_RECORDER_URL || "http://127.0.0.1:5001").replace(
  /\/$/,
  ""
);

async function postJson(path, body = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.detail || `Request failed (${res.status})`);
  }
  return data;
}

export async function checkRecorderHealth() {
  try {
    const res = await fetch(`${BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function startOfflineSession({
  tZero,
  participantId,
  participantName,
  sessionNumber,
  videoFps,
}) {
  return postJson("/session/start", {
    tZero,
    participantId,
    participantName,
    sessionNumber,
    videoFps: videoFps ?? 30,
  });
}

export async function stopOfflineSession(meta = {}) {
  return postJson("/session/stop", meta);
}

/**
 * Upload browser MediaRecorder WebM blob; server merges into video.webm.
 * @param {Blob} webmBlob
 */
export async function uploadSessionWebm(webmBlob) {
  const res = await fetch(`${BASE}/session/video/webm`, {
    method: "POST",
    headers: { "Content-Type": "video/webm" },
    body: webmBlob,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || data.detail || `WebM upload failed (${res.status})`);
  }
  if (data.video_path) {
    console.log("Final video file:", data.video_path);
    if (data.video_size != null) {
      console.log("Video size:", data.video_size);
    }
  }
  return data;
}

export function openLandmarksWebSocket() {
  const wsUrl = BASE.replace(/^http/, "ws") + "/ws/landmarks";
  return new WebSocket(wsUrl);
}

export function getSessionsRootDisplay() {
  return CONFIG.SESSIONS_ROOT_DISPLAY || "E:\\SensorData\\Sessions";
}
