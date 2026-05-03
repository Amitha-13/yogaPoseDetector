import { useEffect, useRef, useState } from "react";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";
import {
  computeEightAngles,
  diffCompareAngle,
  getCorrections,
  minJointVisibility,
  POSE_LM,
} from "../utils/practicePoseAnalysis";
import { getTargetAnglesForPoseName } from "../data/practicePoseTargets";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_PATH =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const CORE_INDICES = [
  POSE_LM.LEFT_SHOULDER,
  POSE_LM.RIGHT_SHOULDER,
  POSE_LM.LEFT_HIP,
  POSE_LM.RIGHT_HIP,
];

const UI_UPDATE_MS = 120;

function syncCanvasToVideo(canvas, video) {
  if (!canvas || !video || !video.videoWidth) return;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const rw = video.getBoundingClientRect().width;
  const rh = video.getBoundingClientRect().height;
  canvas.style.width = `${rw}px`;
  canvas.style.height = `${rh}px`;
}

/**
 * Loads MediaPipe PoseLandmarker, draws skeleton on canvas, updates practice context (throttled).
 */
export function usePracticePoseDetection({
  videoRef,
  canvasRef,
  enabled,
  practicePoseName,
  setDetectedPose,
  setConfidence,
  setCorrections,
}) {
  const [mediapipeError, setMediapipeError] = useState(null);
  const lastVideoTimeRef = useRef(-1);
  const lastUiUpdateRef = useRef(0);
  const practicePoseNameRef = useRef(practicePoseName);
  practicePoseNameRef.current = practicePoseName;

  useEffect(() => {
    if (!enabled) {
      setMediapipeError(null);
      return;
    }

    let cancelled = false;
    let landmarker = null;
    let rafId = 0;
    let drawingUtils = null;

    (async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
        landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: MODEL_PATH,
            delegate: "CPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch (e) {
        if (!cancelled) {
          setMediapipeError(
            e?.message ||
              "Could not load pose model. Check your network and try again."
          );
        }
        return;
      }

      if (cancelled) {
        landmarker?.close();
        return;
      }

      setMediapipeError(null);
      const targetAngles = () =>
        getTargetAnglesForPoseName(practicePoseNameRef.current);

      const loop = () => {
        if (cancelled) return;

        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (!landmarker || !video || !canvas) {
          rafId = requestAnimationFrame(loop);
          return;
        }

        if (video.readyState < 2) {
          rafId = requestAnimationFrame(loop);
          return;
        }

        syncCanvasToVideo(canvas, video);

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          rafId = requestAnimationFrame(loop);
          return;
        }

        if (!drawingUtils) {
          drawingUtils = new DrawingUtils(ctx);
        }

        if (video.currentTime === lastVideoTimeRef.current) {
          rafId = requestAnimationFrame(loop);
          return;
        }
        lastVideoTimeRef.current = video.currentTime;

        let result;
        try {
          result = landmarker.detectForVideo(video, performance.now());
        } catch {
          rafId = requestAnimationFrame(loop);
          return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const landmarks = result?.landmarks?.[0];
        const now = performance.now();

        if (
          landmarks &&
          minJointVisibility(landmarks, CORE_INDICES) >= 0.35
        ) {
          drawingUtils.drawConnectors(
            landmarks,
            PoseLandmarker.POSE_CONNECTIONS,
            { color: "#00c853", lineWidth: 4 }
          );
          drawingUtils.drawLandmarks(landmarks, {
            color: "#ff1744",
            lineWidth: 2,
            radius: 5,
          });

          const angles = computeEightAngles(landmarks);
          const tAngles = targetAngles();
          const corrections = getCorrections(angles, tAngles);
          const aScore = diffCompareAngle(angles, tAngles);
          const conf = Math.round(
            Math.max(0, Math.min(100, (1 - aScore) * 100))
          );

          if (now - lastUiUpdateRef.current >= UI_UPDATE_MS) {
            lastUiUpdateRef.current = now;
            setCorrections(corrections);
            setConfidence(conf);
            const label = practicePoseNameRef.current;
            setDetectedPose(conf >= 48 ? label : "—");
          }
        } else {
          if (now - lastUiUpdateRef.current >= UI_UPDATE_MS) {
            lastUiUpdateRef.current = now;
            setDetectedPose("—");
            setConfidence(0);
            setCorrections([
              "Step into frame so your upper body and hips are visible",
            ]);
          }
        }

        rafId = requestAnimationFrame(loop);
      };

      rafId = requestAnimationFrame(loop);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      lastVideoTimeRef.current = -1;
      landmarker?.close();
      landmarker = null;
      drawingUtils = null;
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    };
  }, [enabled, videoRef, canvasRef, setDetectedPose, setConfidence, setCorrections]);

  return { mediapipeError };
}
