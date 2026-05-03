/**
 * Joint angles and correction messages aligned with server/main6.py (compare_pose).
 * Indices: [0] right elbow, [1] left elbow, [2] right shoulder, [3] left shoulder,
 * [4] right hip, [5] left hip, [6] right knee, [7] left knee.
 */

export const POSE_LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

export function calculateAngle(a, b, c) {
  const ax = a.x;
  const ay = a.y;
  const bx = b.x;
  const by = b.y;
  const cx = c.x;
  const cy = c.y;
  let radians =
    Math.atan2(cy - by, cx - bx) - Math.atan2(ay - by, ax - bx);
  let angle = Math.abs((radians * 180.0) / Math.PI);
  if (angle > 180.0) angle = 360 - angle;
  return angle;
}

export function computeEightAngles(landmarks) {
  const p = (i) => landmarks[i];
  const rs = p(POSE_LM.RIGHT_SHOULDER);
  const re = p(POSE_LM.RIGHT_ELBOW);
  const rw = p(POSE_LM.RIGHT_WRIST);
  const ls = p(POSE_LM.LEFT_SHOULDER);
  const le = p(POSE_LM.LEFT_ELBOW);
  const lw = p(POSE_LM.LEFT_WRIST);
  const rh = p(POSE_LM.RIGHT_HIP);
  const lh = p(POSE_LM.LEFT_HIP);
  const rk = p(POSE_LM.RIGHT_KNEE);
  const lk = p(POSE_LM.LEFT_KNEE);
  const ra = p(POSE_LM.RIGHT_ANKLE);
  const la = p(POSE_LM.LEFT_ANKLE);

  return [
    Math.round(calculateAngle(rs, re, rw)),
    Math.round(calculateAngle(ls, le, lw)),
    Math.round(calculateAngle(re, rs, rh)),
    Math.round(calculateAngle(le, ls, lh)),
    Math.round(calculateAngle(rs, rh, rk)),
    Math.round(calculateAngle(ls, lh, lk)),
    Math.round(calculateAngle(rh, rk, ra)),
    Math.round(calculateAngle(lh, lk, la)),
  ];
}

function average(arr) {
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

/** Mirrors diff_compare_angle in main6.py */
export function diffCompareAngle(user, target) {
  const diffs = [];
  for (let i = 0; i < user.length; i++) {
    const mid = (user[i] + target[i]) / 2;
    const z = mid === 0 ? 0 : Math.abs(user[i] - target[i]) / mid;
    diffs.push(z);
  }
  return average(diffs);
}

const ANGLE_TOL = 15;

/** Mirrors compare_pose feedback strings from main6.py */
export function getCorrections(angleUser, angleTarget) {
  const u = angleUser;
  const t = angleTarget;
  const out = [];

  if (u[0] < t[0] - ANGLE_TOL) out.push("Extend the right arm at elbow");
  if (u[0] > t[0] + ANGLE_TOL) out.push("Fold the right arm at elbow");
  if (u[1] < t[1] - ANGLE_TOL) out.push("Extend the left arm at elbow");
  if (u[1] > t[1] + ANGLE_TOL) out.push("Fold the left arm at elbow");
  if (u[2] < t[2] - ANGLE_TOL) out.push("Lift your right arm");
  if (u[2] > t[2] + ANGLE_TOL) out.push("Put your right arm down a little");
  if (u[3] < t[3] - ANGLE_TOL) out.push("Lift your left arm");
  if (u[3] > t[3] + ANGLE_TOL) out.push("Put your left arm down a little");
  if (u[4] < t[4] - ANGLE_TOL) out.push("Extend the angle at right hip");
  if (u[4] > t[4] + ANGLE_TOL) out.push("Reduce the angle at right hip");
  if (u[5] < t[5] - ANGLE_TOL) out.push("Extend the angle at left hip");
  if (u[5] > t[5] + ANGLE_TOL) out.push("Reduce the angle at left hip");
  if (u[6] < t[6] - ANGLE_TOL) out.push("Extend the angle of right knee");
  if (u[6] > t[6] + ANGLE_TOL) out.push("Reduce the angle at right knee");
  if (u[7] < t[7] - ANGLE_TOL) out.push("Extend the angle at left knee");
  if (u[7] > t[7] + ANGLE_TOL) out.push("Reduce the angle at left knee");

  return out;
}

export function minJointVisibility(landmarks, indices) {
  let m = 1;
  for (const i of indices) {
    const v = landmarks[i]?.visibility ?? 0;
    if (v < m) m = v;
  }
  return m;
}
