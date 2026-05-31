import {
  LANDMARK_COORDINATE_SYSTEM,
  LANDMARK_SCHEMA,
  MEDIAPIPE_POSE_33_LANDMARK_NAMES,
} from "../constants/mediapipePose33Landmarks";

const COORD_KEYS = ["x", "y", "z", "visibility"];

function stripLandmarkNames(frames) {
  if (!Array.isArray(frames)) return [];
  return frames.map((frame) => {
    if (!frame || typeof frame !== "object") return frame;
    const row = { ...frame };
    if (Array.isArray(row.landmarks)) {
      row.landmarks = row.landmarks.map((lm) => {
        if (!lm || typeof lm !== "object") return lm;
        const point = {};
        COORD_KEYS.forEach((key) => {
          if (key in lm) point[key] = lm[key];
        });
        return point;
      });
    }
    return row;
  });
}

function extractFrames(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    if (Array.isArray(data.frames)) return data.frames;
    if (Array.isArray(data.landmarks)) return data.landmarks;
  }
  return [];
}

/**
 * Build landmarks export document with schema metadata once at root.
 */
export function buildLandmarksExportDocument(
  data,
  { samplingRate = "30fps", videoFps } = {}
) {
  const rate =
    samplingRate ||
    (videoFps != null && Number.isFinite(Number(videoFps))
      ? `${Math.round(Number(videoFps))}fps`
      : "30fps");

  if (
    data &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    data.landmarkSchema === LANDMARK_SCHEMA &&
    Array.isArray(data.landmarkNames)
  ) {
    const frames = stripLandmarkNames(extractFrames(data));
    return {
      landmarkSchema: LANDMARK_SCHEMA,
      landmarkNames: [...MEDIAPIPE_POSE_33_LANDMARK_NAMES],
      totalFrames: data.totalFrames ?? frames.length,
      samplingRate: data.samplingRate ?? rate,
      coordinateSystem: data.coordinateSystem ?? LANDMARK_COORDINATE_SYSTEM,
      frames,
    };
  }

  const frames = stripLandmarkNames(extractFrames(data));
  return {
    landmarkSchema: LANDMARK_SCHEMA,
    landmarkNames: [...MEDIAPIPE_POSE_33_LANDMARK_NAMES],
    totalFrames: frames.length,
    samplingRate: rate,
    coordinateSystem: LANDMARK_COORDINATE_SYSTEM,
    frames,
  };
}
