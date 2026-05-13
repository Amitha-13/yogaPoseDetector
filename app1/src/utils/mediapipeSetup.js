/**
 * MediaPipe Pose via CDN globals (Pose, Camera utils).
 * Uses requestAnimationFrame to feed frames instead of Camera.start() so we do not
 * replace the existing getUserMedia stream on the video element during recording.
 *
 * Overlay alignment: landmarks are normalized (0–1) to the full video frame that
 * MediaPipe processes. The <video> uses object-fit: cover, which crops that frame
 * when the element's aspect ratio differs. Drawing must map normalized coords into
 * the same visible sub-rectangle as the video, then scale by devicePixelRatio.
 */

/**
 * Visible rect of the video bitmap inside the element when object-fit is `cover`
 * (same math as CSS).
 */
function getObjectFitCoverLayout(
  intrinsicWidth,
  intrinsicHeight,
  containerWidth,
  containerHeight
) {
  const scale = Math.max(
    containerWidth / intrinsicWidth,
    containerHeight / intrinsicHeight
  );
  const displayedWidth = intrinsicWidth * scale;
  const displayedHeight = intrinsicHeight * scale;
  const offsetX = (containerWidth - displayedWidth) / 2;
  const offsetY = (containerHeight - displayedHeight) / 2;
  return { displayedWidth, displayedHeight, offsetX, offsetY };
}

function drawNormalizedLandmarksAsDots(
  ctx,
  landmarks,
  mapX,
  mapY,
  options
) {
  if (!landmarks?.length) return;
  const { color, radius = 4 } = options || {};
  ctx.fillStyle = color || "#FF0000";
  for (const lm of landmarks) {
    ctx.beginPath();
    ctx.arc(mapX(lm), mapY(lm), radius, 0, 2 * Math.PI);
    ctx.fill();
  }
}

function drawNormalizedConnections(
  ctx,
  landmarks,
  connections,
  mapX,
  mapY,
  options
) {
  if (!connections?.length || !landmarks?.length) return;
  const { color, lineWidth = 3 } = options || {};
  ctx.strokeStyle = color || "#00FF00";
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  for (const conn of connections) {
    const startIdx =
      conn?.start !== undefined ? conn.start : conn?.[0];
    const endIdx =
      conn?.end !== undefined ? conn.end : conn?.[1];
    const a = landmarks[startIdx];
    const b = landmarks[endIdx];
    if (!a || !b) continue;
    ctx.moveTo(mapX(a), mapY(a));
    ctx.lineTo(mapX(b), mapY(b));
  }
  ctx.stroke();
}

export function initMediaPipe(
  videoElement,
  canvasElement,
  onLandmarks,
  tZero,
  onRawResults
) {
  if (typeof window.Pose !== "function") {
    console.warn("MediaPipe Pose script not loaded");
    return function noop() {};
  }

  canvasElement.style.position = "absolute";
  canvasElement.style.top = "0";
  canvasElement.style.left = "0";
  canvasElement.style.width = "100%";
  canvasElement.style.height = "100%";
  canvasElement.style.pointerEvents = "none";
  canvasElement.style.zIndex = "2";

  const pose = new window.Pose({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`,
  });

  pose.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    smoothSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  const canvasCtx = canvasElement.getContext("2d");
  let frameCount = 0;
  let isRunning = true;
  let rafId = 0;

  pose.onResults((results) => {
    if (!isRunning) return;

    if (!videoElement.videoWidth) return;

    const rect = videoElement.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    if (cssW <= 0 || cssH <= 0) return;

    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;

    const { displayedWidth, displayedHeight, offsetX, offsetY } =
      getObjectFitCoverLayout(vw, vh, cssW, cssH);

    const dpr =
      typeof window !== "undefined"
        ? Math.min(window.devicePixelRatio || 1, 3)
        : 1;

    const bufW = Math.max(1, Math.round(cssW * dpr));
    const bufH = Math.max(1, Math.round(cssH * dpr));

    canvasElement.width = bufW;
    canvasElement.height = bufH;

    canvasElement.style.width = cssW + "px";
    canvasElement.style.height = cssH + "px";

    canvasCtx.save();

    canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    canvasCtx.clearRect(0, 0, cssW, cssH);

    const mapX = (lm) => offsetX + lm.x * displayedWidth;
    const mapY = (lm) => offsetY + lm.y * displayedHeight;

    if (results.poseLandmarks) {
<<<<<<< HEAD
      drawNormalizedConnections(
=======
      // Live Data Bridge: Send raw landmarks if callback provided
      if (typeof onRawResults === "function") {
        onRawResults(results.poseLandmarks);
      }

      const drawLandmarksFn =
        typeof window.drawLandmarks === "function"
          ? window.drawLandmarks
          : undefined;
      const drawConnectorsFn =
        typeof window.drawConnectors === "function"
          ? window.drawConnectors
          : undefined;
      drawFrame(
        results.poseLandmarks,
>>>>>>> b6d83053e9b3288e51252cf3b32388035fe7dbbf
        canvasCtx,
        results.poseLandmarks,
        window.POSE_CONNECTIONS,
        mapX,
        mapY,
        {
          color: "#00FF00",
          lineWidth: 3,
        }
      );

      drawNormalizedLandmarksAsDots(
        canvasCtx,
        results.poseLandmarks,
        mapX,
        mapY,
        {
          color: "#FF0000",
          radius: 4,
        }
      );

      const LANDMARK_NAMES = [
        "nose",
        "left_eye_inner",
        "left_eye",
        "left_eye_outer",
        "right_eye_inner",
        "right_eye",
        "right_eye_outer",
        "left_ear",
        "right_ear",
        "mouth_left",
        "mouth_right",
        "left_shoulder",
        "right_shoulder",
        "left_elbow",
        "right_elbow",
        "left_wrist",
        "right_wrist",
        "left_pinky",
        "right_pinky",
        "left_index",
        "right_index",
        "left_thumb",
        "right_thumb",
        "left_hip",
        "right_hip",
        "left_knee",
        "right_knee",
        "left_ankle",
        "right_ankle",
        "left_heel",
        "right_heel",
        "left_foot_index",
        "right_foot_index",
      ];

      const namedLandmarks = results.poseLandmarks.map((lm, i) => ({
        name: LANDMARK_NAMES[i] ?? `joint_${i}`,
        x: parseFloat(lm.x.toFixed(6)),
        y: parseFloat(lm.y.toFixed(6)),
        z: parseFloat((lm.z ?? 0).toFixed(6)),
        visibility:
          lm.visibility != null
            ? parseFloat(lm.visibility.toFixed(4))
            : null,
      }));

      onLandmarks({
        frame: frameCount,
        relative_timestamp: Date.now() - tZero,
        landmarks: namedLandmarks,
      });

      frameCount++;
    }

    if (results.faceLandmarks?.length) {
      drawNormalizedLandmarksAsDots(
        canvasCtx,
        results.faceLandmarks,
        mapX,
        mapY,
        {
          color: "#00B0FF",
          radius: 1.5,
        }
      );
    }

    canvasCtx.restore();
  });

  const tick = async () => {
    if (!isRunning) return;
    if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        await pose.send({ image: videoElement });
      } catch (_) {
        /* ignore single-frame failures */
      }
    }
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return function cleanup() {
    isRunning = false;
    cancelAnimationFrame(rafId);
    pose.close();
    try {
      canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    } catch (_) {
      /* noop */
    }
  };
}
