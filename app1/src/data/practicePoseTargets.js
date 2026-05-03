/**
 * Ideal joint-angle targets (degrees) per practice pose for compare_pose-style feedback.
 * Tune these against your reference photos / server Video targets as needed.
 */
export const PRACTICE_POSE_TARGETS = {
  "Mountain Pose": [175, 175, 175, 175, 175, 175, 175, 175],
  "Tree Pose": [165, 170, 160, 175, 110, 175, 165, 175],
  "Warrior I": [165, 165, 145, 145, 105, 105, 160, 160],
  "Warrior II": [160, 160, 95, 95, 105, 105, 165, 165],
  "Triangle Pose": [170, 100, 120, 120, 100, 170, 165, 165],
  "Downward Dog": [175, 175, 180, 180, 165, 165, 165, 165],
  "Chair Pose": [160, 160, 150, 150, 95, 95, 95, 95],
  "Cobra Pose": [165, 165, 55, 55, 140, 140, 165, 165],
  "Bridge Pose": [160, 160, 120, 120, 85, 85, 85, 85],
  "Child's Pose": [130, 130, 35, 35, 115, 115, 85, 85],
};

export function getTargetAnglesForPoseName(name) {
  return PRACTICE_POSE_TARGETS[name] ?? PRACTICE_POSE_TARGETS["Mountain Pose"];
}
