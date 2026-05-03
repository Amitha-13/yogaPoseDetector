import React, { createContext, useContext, useMemo, useState } from "react";

const PracticeContext = createContext(null);

export const PracticeContextProvider = ({ children }) => {
  const [selectedPose, setSelectedPose] = useState(null);
  const [detectedPose, setDetectedPose] = useState(null);
  const [confidence, setConfidence] = useState(0);
  const [corrections, setCorrections] = useState([]);
  const [isSessionActive, setIsSessionActive] = useState(false);

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
    }),
    [selectedPose, detectedPose, confidence, corrections, isSessionActive]
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
