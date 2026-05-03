import React, { createContext, useContext, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";

const SessionContext = createContext(null);

const defaultOperatorInfo = {
  operatorName: "",
  institutionName: "",
};

const defaultMetadata = {
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

export const SessionContextProvider = ({ children }) => {
  const [operatorInfo, setOperatorInfo] = useState(defaultOperatorInfo);
  const [participantId] = useState(() => uuidv4());
  const [metadata, setMetadata] = useState(defaultMetadata);
  const [consentChecks, setConsentChecks] = useState(defaultConsentChecks);
  const [selectedPoses, setSelectedPoses] = useState([]);
  const [driveAccessToken, setDriveAccessToken] = useState(null);
  const [sessionRecordings, setSessionRecordings] = useState([]);
  const [tZero, setTZero] = useState(null);
  const [cameraStream, setCameraStream] = useState(null);

  const consentGiven = Object.values(consentChecks).every(Boolean);

  const value = useMemo(
    () => ({
      operatorInfo,
      setOperatorInfo,
      participantId,
      metadata,
      setMetadata,
      consentChecks,
      setConsentChecks,
      consentGiven,
      selectedPoses,
      setSelectedPoses,
      driveAccessToken,
      setDriveAccessToken,
      sessionRecordings,
      setSessionRecordings,
      tZero,
      setTZero,
      cameraStream,
      setCameraStream,
    }),
    [
      operatorInfo,
      participantId,
      metadata,
      consentChecks,
      consentGiven,
      selectedPoses,
      driveAccessToken,
      sessionRecordings,
      tZero,
      cameraStream,
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
