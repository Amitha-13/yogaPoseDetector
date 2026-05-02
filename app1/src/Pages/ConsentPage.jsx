import React from "react";
import { useNavigate } from "react-router-dom";
import CONFIG from "../config";
import { useSession } from "../context/SessionContext";
import "./ConsentPage.css";

const ConsentPage = () => {
  const navigate = useNavigate();

  const {
    participantId,
    metadata,
    consentChecks,
    consentGiven,
    driveAccessToken,
    setConsentChecks,
    setDriveAccessToken,
  } = useSession();

  const signInWithGoogle = () => {
    if (!window.google?.accounts?.oauth2) {
      alert("Google Identity Services not loaded.");
      return;
    }

    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (response) => {
        if (response?.access_token) {
          console.log("✅ TOKEN RECEIVED:", response.access_token); // 👈 ADD THIS (for testing)
          setDriveAccessToken(response.access_token);
        } else {
          console.error("❌ No access token received", response);
        }
      },
    });

    tokenClient.requestAccessToken();
  };

  const updateConsent = (key) => {
    setConsentChecks((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const canInitialize = consentGiven && driveAccessToken !== null;

  return (
    <div className="consent-page">
      <div className="consent-card">
        <div className="summary-line">
          Participant ID: {participantId}
        </div>

        <div className="summary-line">
          Age: {metadata.age} | Gender: {metadata.gender} | Experience: {metadata.experience}
        </div>

        <h2 className="consent-heading">Consent Confirmation</h2>

        <p className="consent-subtitle">
          Operator must confirm all 4 items before proceeding
        </p>

        {/* Consent checkboxes */}
        <label className="consent-check">
          <input
            type="checkbox"
            checked={consentChecks.videoRecording}
            onChange={() => updateConsent("videoRecording")}
          />
          Participant has agreed to video recording
        </label>

        <label className="consent-check">
          <input
            type="checkbox"
            checked={consentChecks.sensorData}
            onChange={() => updateConsent("sensorData")}
          />
          Participant has agreed to sensor/IMU data collection
        </label>

        <label className="consent-check">
          <input
            type="checkbox"
            checked={consentChecks.researchUse}
            onChange={() => updateConsent("researchUse")}
          />
          Participant has agreed to research use of collected data
        </label>

        <label className="consent-check">
          <input
            type="checkbox"
            checked={consentChecks.dataStorage}
            onChange={() => updateConsent("dataStorage")}
          />
          Participant understands data will be stored securely in the lab Google Drive
        </label>

        {/* Google Sign-in */}
        <div className="google-block">
          <button
            type="button"
            className="google-btn"
            onClick={signInWithGoogle}
          >
            Sign in with Google (Drive Access)
          </button>

          <div
            className={`google-status ${
              driveAccessToken ? "ok-status" : "bad-status"
            }`}
          >
            {driveAccessToken
              ? "Drive access granted ✓"
              : "Drive access not granted"}
          </div>
        </div>

        {/* Next Button */}
        <button
          type="button"
          className="consent-submit"
          disabled={!canInitialize}
          onClick={() => navigate("/hardware")}
        >
          Initialize Hardware →
        </button>
      </div>
    </div>
  );
};

export default ConsentPage;