let mediaRecorder = null;
let recordedChunks = [];
let imuWorker = null;
let imuBuffer = [];
let tZero = null;

export function startRecording(stream) {
  tZero = Date.now();
  recordedChunks = [];
  imuBuffer = [];

  mediaRecorder = new MediaRecorder(stream, {
    mimeType: "video/webm;codecs=vp8,opus",
  });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };
  mediaRecorder.start(100);

  imuWorker = new Worker(new URL("../workers/imuWorker.js", import.meta.url));
  imuWorker.onmessage = (e) => imuBuffer.push(e.data);
  imuWorker.postMessage({ type: "START", tZero });

  return tZero;
}

export function stopRecording() {
  return new Promise((resolve) => {
    if (!mediaRecorder) {
      if (imuWorker) {
        imuWorker.postMessage({ type: "STOP" });
        imuWorker = null;
      }
      resolve({
        videoBlob: new Blob(recordedChunks, { type: "video/webm" }),
        imuPackets: [...imuBuffer],
        tZero,
      });
      return;
    }

    mediaRecorder.onstop = () => {
      const videoBlob = new Blob(recordedChunks, { type: "video/webm" });
      if (imuWorker) {
        imuWorker.postMessage({ type: "STOP" });
        imuWorker = null;
      }
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
