import React from "react";
import { useNavigate } from "react-router-dom";
import { usePractice } from "../../context/PracticeContext";
import "../ConsentPage.css";

const PracticeConsentPage = () => {
  const navigate = useNavigate();
  const { consentChecks, consentGiven, setConsentChecks } = usePractice();

  const updateConsent = (key) => {
    setConsentChecks((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div className="consent-page">
      <div className="consent-card">
        <h2 className="consent-heading">Yoga Practice — Consent</h2>
        <p className="consent-subtitle">
          Please confirm all items before starting your practice session.
        </p>

        <label className="consent-check">
          <input
            type="checkbox"
            checked={consentChecks.videoRecording}
            onChange={() => updateConsent("videoRecording")}
          />
          I agree to video recording during this practice session
        </label>

        <label className="consent-check">
          <input
            type="checkbox"
            checked={consentChecks.poseAnalysis}
            onChange={() => updateConsent("poseAnalysis")}
          />
          I agree to real-time pose analysis using my webcam
        </label>

        <label className="consent-check">
          <input
            type="checkbox"
            checked={consentChecks.dataStorage}
            onChange={() => updateConsent("dataStorage")}
          />
          I understand recorded data may be saved locally or uploaded to cloud storage
        </label>

        <label className="consent-check">
          <input
            type="checkbox"
            checked={consentChecks.termsAccepted}
            onChange={() => updateConsent("termsAccepted")}
          />
          I accept the terms of use for this yoga practice application
        </label>

        <button
          type="button"
          className="consent-submit"
          disabled={!consentGiven}
          onClick={() => navigate("/practice")}
        >
          Continue to Yoga Practice →
        </button>
      </div>
    </div>
  );
};

export default PracticeConsentPage;
