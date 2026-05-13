export function sanitizeToken(value, fallback = "unknown") {
  const cleaned = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return cleaned || fallback;
}

export function formatDateTimeParts(dateInput = new Date()) {
  const d = new Date(dateInput);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return {
    date: `${yyyy}-${mm}-${dd}`,
    time: `${hh}-${min}-${ss}`,
    compact: `${yyyy}${mm}${dd}_${hh}${min}${ss}`,
  };
}

export function getGreetingByTime(now = new Date()) {
  const hour = new Date(now).getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

export function buildSessionAssetBase({
  username,
  sessionNumber,
  recordedAt,
  category,
  asanaName,
}) {
  const { date, time } = formatDateTimeParts(recordedAt);
  const user = sanitizeToken(username, "participant");
  const safeCategory = sanitizeToken(category, "general");
  const safeAsana = sanitizeToken(asanaName, "pose");
  const session = String(sessionNumber ?? 1).padStart(2, "0");
  return {
    date,
    time,
    user,
    safeCategory,
    safeAsana,
    session,
    base: `${user}_session${session}_${date}_${time}_${safeCategory}_${safeAsana}`,
  };
}

export function buildFileNames(meta) {
  const { base, compact } = {
    ...buildSessionAssetBase(meta),
    ...formatDateTimeParts(meta.recordedAt),
  };
  return {
    video: `${base}_videosession_${compact}.webm`,
    imu: `${base}_imusession_${compact}.json`,
    fsr: `${base}_fsrsession_${compact}.json`,
    landmarks: `${base}_landmarks_${compact}.json`,
    metadata: `${base}_metadata_${compact}.json`,
    zip: `${base}.zip`,
    summary: `${sanitizeToken(meta.username, "participant")}_session${String(
      meta.sessionNumber ?? 1
    ).padStart(2, "0")}_${formatDateTimeParts(meta.recordedAt).date}_summary.json`,
  };
}
