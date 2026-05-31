/**
 * Participant folder: NAME_PARTS_NNN (numeric suffix only).
 * Examples: DEVIKA_392, ANJANA_M_562, AMITHA_SHAJI_K_234
 */
export function numericParticipantSuffix(participantId) {
  const source = String(participantId || "0");
  let crc = 0xffffffff;
  for (let i = 0; i < source.length; i += 1) {
    crc ^= source.charCodeAt(i);
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return String((crc ^ 0xffffffff) % 1000).padStart(3, "0");
}

export function buildParticipantFolderName({ name, participantId }) {
  const parts = String(name || "participant")
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean);
  const nameToken = parts.map((part) => part.toUpperCase()).join("_") || "PARTICIPANT";
  return `${nameToken}_${numericParticipantSuffix(participantId)}`;
}

/**
 * Pose folder: PoseName_PoseID (e.g. Triangle_Pose_STA-05-I)
 */
export function buildPoseFolderName(poseName, poseId) {
  const sanitize = (value, fallback) => {
    const cleaned = String(value || fallback)
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    return cleaned || fallback;
  };
  const namePart = sanitize(poseName, "Pose").replace(/_/g, "_");
  const idPart = sanitize(poseId, "POSE");
  return `${namePart}_${idPart}`;
}
