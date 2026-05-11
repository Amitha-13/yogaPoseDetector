/**
 * MediaPipe Pose via CDN globals (Pose, Camera utils).
 * Uses requestAnimationFrame to feed frames instead of Camera.start() so we do not
 * replace the existing getUserMedia stream on the video element during recording.
 */
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

  const drawFrame = (
    landmarks,
    ctx,
    connectors,
    drawConnectorsFn,
    drawLandmarksFn
  ) => {
    if (
      typeof drawConnectorsFn === "function" &&
      typeof drawLandmarksFn === "function" &&
      connectors
    ) {
      drawConnectorsFn(ctx, landmarks, connectors, {
        color: "#00FF00",
        lineWidth: 3,
      });
      drawLandmarksFn(ctx, landmarks, {
        color: "#FF0000",
        lineWidth: 2,
        radius: 4,
      });
      return;
    }
    ctx.fillStyle = "#ff0000";
    for (const lm of landmarks) {
      ctx.beginPath();
      ctx.arc(
        lm.x * canvasElement.width,
        lm.y * canvasElement.height,
        4,
        0,
        2 * Math.PI
      );
      ctx.fill();
    }
  };

  pose.onResults((results) => {
    if (!isRunning) return;

    if (!videoElement.videoWidth) return;

    canvasElement.width = videoElement.videoWidth;
    canvasElement.height = videoElement.videoHeight;

    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    if (results.poseLandmarks) {
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
        canvasCtx,
        window.POSE_CONNECTIONS,
        drawConnectorsFn,
        drawLandmarksFn
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
