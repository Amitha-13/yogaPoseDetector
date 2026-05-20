import React, { createContext, useContext, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { getGreetingByTime } from "../utils/sessionNaming";

const SessionContext = createContext(null);

const defaultOperatorInfo = {
  operatorName: "",
  institutionName: "",
};

const defaultMetadata = {
  username: "",
  sessionNumber: 1,
  name: "",
  age: "",
  gender: "",
  height: "",
  weight: "",
  experience: "",
  healthRemarks: "",
  sessionDate: new Date().toLocaleString(),
};

const defaultConsentChecks = {
  videoRecording: false,
  sensorData: false,
  researchUse: false,
  dataStorage: false,
};

const HARDWARE_CALIBRATION_SESSION_KEY = "yoga_hardware_calibration_done";

export const SessionContextProvider = ({ children }) => {
  const [username, setUsernameState] = useState(() => {
    if (typeof localStorage === "undefined") return "";
    const raw = localStorage.getItem("yoga_username");
    return String(raw ?? "").trim();
  });
  const [sessionNumber, setSessionNumber] = useState(() => {
    if (typeof localStorage === "undefined") return 1;
    const raw = Number(localStorage.getItem("yoga_session_number") || 1);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
  });
  const [operatorInfo, setOperatorInfo] = useState(defaultOperatorInfo);
  const [participantId] = useState(() => uuidv4());
  const [metadata, setMetadata] = useState(defaultMetadata);
  const [consentChecks, setConsentChecks] = useState(defaultConsentChecks);
  const [selectedPoses, setSelectedPoses] = useState([]);
  const [sessionRecordings, setSessionRecordings] = useState([]);
  const [tZero, setTZero] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);
  const [offlineSessionDirectory, setOfflineSessionDirectory] = useState(null);
  const [hardwareCalibrationConfirmed, setHardwareCalibrationConfirmedState] = useState(
    () =>
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(HARDWARE_CALIBRATION_SESSION_KEY) === "1"
  );

  const setHardwareCalibrationConfirmed = (value) => {
    const ok = Boolean(value);
    setHardwareCalibrationConfirmedState(ok);
    if (typeof sessionStorage !== "undefined") {
      if (ok) {
        sessionStorage.setItem(HARDWARE_CALIBRATION_SESSION_KEY, "1");
      } else {
        sessionStorage.removeItem(HARDWARE_CALIBRATION_SESSION_KEY);
      }
    }
  };

  const consentGiven = Object.values(consentChecks).every(Boolean);
  const greeting = getGreetingByTime();

  const setUsername = (value) => {
    const trimmed = String(value || "").trim();
    setUsernameState(trimmed);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("yoga_username", trimmed);
    }
  };

  const bumpSessionNumber = () => {
    setSessionNumber((prev) => {
      const next = prev + 1;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("yoga_session_number", String(next));
      }
      return next;
    });
  };

  const value = useMemo(
    () => ({
      operatorInfo,
      setOperatorInfo,
      username,
      setUsername,
      greeting,
      participantId,
      sessionNumber,
      bumpSessionNumber,
      metadata,
      setMetadata,
      consentChecks,
      setConsentChecks,
      consentGiven,
      selectedPoses,
      setSelectedPoses,
      sessionRecordings,
      setSessionRecordings,
      tZero,
      setTZero,
      cameraStream,
      setCameraStream,
      offlineSessionDirectory,
      setOfflineSessionDirectory,
      hardwareCalibrationConfirmed,
      setHardwareCalibrationConfirmed,
    }),
    [
      operatorInfo,
      participantId,
      username,
      sessionNumber,
      greeting,
      metadata,
      consentChecks,
      consentGiven,
      selectedPoses,
      sessionRecordings,
      tZero,
      cameraStream,
      offlineSessionDirectory,
      hardwareCalibrationConfirmed,
    ]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
};

export const useSession = () => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionContextProvider");
  }
  return context;
};
