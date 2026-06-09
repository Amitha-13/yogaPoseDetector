import CONFIG from "../config";
import { isSlotOnline } from "./sensorStatus";

export const COLLECTION_TYPES = {
  A: {
    id: "A_VideoOnly",
    label: "A_VideoOnly",
    description: "Video + Landmarks only",
  },
  B: {
    id: "B_Video_IMU",
    label: "B_Video_IMU",
    description: "Video + Landmarks + Available Body IMUs",
  },
  C: {
    id: "C_Video_IMU_Footrest",
    label: "C_Video_IMU_Footrest",
    description: "Video + Landmarks + Available Body & Footrest IMUs",
  },
};

const BODY_IDS = CONFIG.SENSOR_SLOTS.filter((s) => s.status === "active").map((s) => s.id);
const FOOTREST_IDS = CONFIG.SENSOR_SLOTS.filter((s) => s.status === "placeholder").map(
  (s) => s.id
);

export function getConnectedSensorIds(imuDevices) {
  return CONFIG.SENSOR_SLOTS.filter((slot) => isSlotOnline(slot, imuDevices)).map(
    (slot) => slot.id
  );
}

export function getBodyConnectionState(imuDevices) {
  const bodyOnline = BODY_IDS.filter((id) => imuDevices[id]?.online === true);
  return {
    allConnected: bodyOnline.length === BODY_IDS.length,
    anyConnected: bodyOnline.length > 0,
    connectedIds: bodyOnline,
    requiredCount: BODY_IDS.length,
  };
}

export function getFootrestConnectionState(imuDevices) {
  const footrestOnline = FOOTREST_IDS.filter((id) => imuDevices[id]?.online === true);
  return {
    allConnected: footrestOnline.length === FOOTREST_IDS.length,
    anyConnected: footrestOnline.length > 0,
    connectedIds: footrestOnline,
    requiredCount: FOOTREST_IDS.length,
  };
}

export function getCollectionTypeAvailability(imuDevices) {
  const body = getBodyConnectionState(imuDevices);
  const footrest = getFootrestConnectionState(imuDevices);

  const aEnabled = true;
  const bEnabled = body.anyConnected;
  const cEnabled = body.anyConnected && footrest.anyConnected;

  return {
    A: {
      enabled: aEnabled,
      disabledReason: null,
    },
    B: {
      enabled: bEnabled,
      disabledReason: bEnabled
        ? null
        : "No body IMU sensors connected",
    },
    C: {
      enabled: cEnabled,
      disabledReason: !body.anyConnected
        ? "No body IMU sensors connected"
        : !footrest.anyConnected
          ? "No footrest IMU sensors connected"
          : null,
    },
  };
}

export function getDefaultCollectionType(imuDevices) {
  const availability = getCollectionTypeAvailability(imuDevices);
  if (availability.C.enabled) return COLLECTION_TYPES.C.id;
  if (availability.B.enabled) return COLLECTION_TYPES.B.id;
  return COLLECTION_TYPES.A.id;
}

export const STORAGE_LOCATIONS = {
  D: { id: "D", label: "D:\\ Local Drive", root: "D:\\YogaDataset" },
  E: { id: "E", label: "E:\\ External Hard Disk", root: "E:\\YogaDataset" },
};
