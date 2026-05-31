import React from "react";
import { Navigate } from "react-router-dom";
import { usePractice } from "../context/PracticeContext";

function RequirePracticeConsent({ children }) {
  const { consentGiven } = usePractice();

  if (!consentGiven) {
    return <Navigate to="/practice/consent" replace />;
  }

  return children;
}

export default RequirePracticeConsent;
