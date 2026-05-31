import { useEffect, useRef, useState } from "react";
import { initMediaPipe } from "../utils/mediapipeSetup";
import {
  computeEightAngles,
  diffCompareAngle,
  getCorrections,
  minJointVisibility,
  POSE_LM,
} from "../utils/practicePoseAnalysis";
import { getTargetAnglesForPoseName } from "../data/practicePoseTargets";

const CORE_INDICES = [
  POSE_LM.LEFT_SHOULDER,
  POSE_LM.RIGHT_SHOULDER,
  POSE_LM.LEFT_HIP,
  POSE_LM.RIGHT_HIP,
];

const UI_UPDATE_MS = 120;

function namedLandmarksToArray(landmarks) {
  if (!landmarks?.length) return null;
  return landmarks.map((lm) => ({
    x: lm.x,
    y: lm.y,
    z: lm.z ?? 0,
    visibility: lm.visibility ?? 0,
  }));
}

/**
 * Yoga Practice (/app) pose pipeline — same MediaPipe init as Data Collection (mediapipeSetup.js).
 */
export function useAppCollectionPose({
  videoRef,
  canvasRef,
  enabled,
  practicePoseName,
  setDetectedPose,
  setConfidence,
  setCorrections,
  onRawLandmarks,
}) {
  const [mediapipeError, setMediapipeError] = useState(null);
  const cleanupRef = useRef(null);
  const poseNameRef = useRef(practicePoseName);
  const onRawRef = useRef(onRawLandmarks);
  const lastUiRef = useRef(0);
  poseNameRef.current = practicePoseName;
  onRawRef.current = onRawLandmarks;

  useEffect(() => {
    if (!enabled) {
      setMediapipeError(null);
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      return undefined;
    }

    if (typeof window.Pose !== "function") {
      setMediapipeError(
        "MediaPipe Pose is not loaded. Refresh the page and check your network."
      );
      return undefined;
    }

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return undefined;

    setMediapipeError(null);
    const tZero = Date.now();

    cleanupRef.current = initMediaPipe(
      video,
      canvas,
      (frameData) => {
        const indexed = namedLandmarksToArray(frameData.landmarks);
        const now = performance.now();
        if (now - lastUiRef.current < UI_UPDATE_MS) return;
        lastUiRef.current = now;

        if (
          indexed &&
          minJointVisibility(indexed, CORE_INDICES) >= 0.35
        ) {
          const angles = computeEightAngles(indexed);
          const target = getTargetAnglesForPoseName(poseNameRef.current);
          const corrections = getCorrections(angles, target);
          const aScore = diffCompareAngle(angles, target);
          const conf = Math.round(
            Math.max(0, Math.min(100, (1 - aScore) * 100))
          );
          setCorrections(corrections);
          setConfidence(conf);
          setDetectedPose(conf >= 48 ? poseNameRef.current : "—");
        } else {
          setDetectedPose("—");
          setConfidence(0);
          setCorrections([
            "Step into frame so your upper body and hips are visible",
          ]);
        }
      },
      tZero,
      (rawLandmarks) => {
        if (typeof onRawRef.current === "function") {
          onRawRef.current(rawLandmarks);
        }
      }
    );

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [
    enabled,
    videoRef,
    canvasRef,
    setDetectedPose,
    setConfidence,
    setCorrections,
  ]);

  return { mediapipeError };
}
