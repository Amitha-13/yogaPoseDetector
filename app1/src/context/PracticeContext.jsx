import React, { createContext, useContext, useMemo, useState } from "react";

const defaultConsentChecks = {
  videoRecording: false,
  poseAnalysis: false,
  dataStorage: false,
  termsAccepted: false,
};

const PracticeContext = createContext(null);

export const PracticeContextProvider = ({ children }) => {
  const [selectedPose, setSelectedPose] = useState(null);
  const [detectedPose, setDetectedPose] = useState(null);
  const [confidence, setConfidence] = useState(0);
  const [corrections, setCorrections] = useState([]);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [consentChecks, setConsentChecks] = useState(defaultConsentChecks);
  const [practiceSessionId, setPracticeSessionId] = useState(null);
  const [offlineSessionDirectory, setOfflineSessionDirectory] = useState(null);

  const consentGiven = useMemo(
    () => Object.values(consentChecks).every(Boolean),
    [consentChecks]
  );

  const value = useMemo(
    () => ({
      selectedPose,
      setSelectedPose,
      detectedPose,
      setDetectedPose,
      confidence,
      setConfidence,
      corrections,
      setCorrections,
      isSessionActive,
      setIsSessionActive,
      consentChecks,
      setConsentChecks,
      consentGiven,
      practiceSessionId,
      setPracticeSessionId,
      offlineSessionDirectory,
      setOfflineSessionDirectory,
    }),
    [
      selectedPose,
      detectedPose,
      confidence,
      corrections,
      isSessionActive,
      consentChecks,
      consentGiven,
      practiceSessionId,
      offlineSessionDirectory,
    ]
  );

  return <PracticeContext.Provider value={value}>{children}</PracticeContext.Provider>;
};

export const usePractice = () => {
  const context = useContext(PracticeContext);
  if (!context) {
    throw new Error("usePractice must be used within PracticeContextProvider");
  }
  return context;
};
