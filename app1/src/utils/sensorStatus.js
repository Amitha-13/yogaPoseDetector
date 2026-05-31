/** Shared sensor UI helpers — slot definitions live in config.js / sensor_registry.py */

export function isSlotOnline(slot, imuDevices) {
  return imuDevices[slot.id]?.online === true;
}

export function countActiveOnline(imuDevices, sensorSlots) {
  return sensorSlots.filter(
    (slot) => slot.status === "active" && isSlotOnline(slot, imuDevices)
  ).length;
}

export function isPlaceholderSlot(slot) {
  return slot.status === "placeholder";
}

export function capsuleVariant(slot, isLive) {
  if (isLive) return "live";
  if (isPlaceholderSlot(slot)) return "reserved";
  return "missing";
}

export function cardVariant(slot, isLive) {
  if (isLive) return "live";
  if (isPlaceholderSlot(slot)) return "placeholder";
  return "timeout";
}

export function slotStatusLabel(slot, isLive) {
  if (isLive) return "Connected";
  if (isPlaceholderSlot(slot)) return "Placeholder";
  return "Disconnected";
}

export function slotOfflineMessage(slot) {
  if (isPlaceholderSlot(slot)) {
    return "Footrest placeholder — not connected. Hardware integration pending.";
  }
  return "Expected sensor not detected. Check ESP32 WiFi connection.";
}

export function countFootrestOnline(imuDevices, sensorSlots) {
  return sensorSlots.filter(
    (slot) => isPlaceholderSlot(slot) && isSlotOnline(slot, imuDevices)
  ).length;
}

export function normalizeImuPollPayload(data, sensorSlots) {
  const normalized = {};
  if (!data || typeof data !== "object") return normalized;
  sensorSlots.forEach((slot) => {
    const device = data[slot.id];
    if (device && typeof device === "object") {
      normalized[slot.id] = {
        ...device,
        online: device.online === true,
        packet_count:
          typeof device.packet_count === "number" ? device.packet_count : null,
        voltage: typeof device.voltage === "number" ? device.voltage : null,
        rssi: typeof device.rssi === "number" ? device.rssi : null,
        lastSeen: Date.now(),
      };
    }
  });
  return normalized;
}
