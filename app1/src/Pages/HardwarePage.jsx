import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import CONFIG from "../config";
import "./HardwarePage.css";

function HardwarePage() {
  const navigate = useNavigate();
  const { setTZero, setCameraStream, participantId, metadata, username, greeting } = useSession();

  const [stream, setStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [imuDevices, setImuDevices] = useState({});
  const [flaskReachable, setFlaskReachable] = useState(false);
  const [startupState, setStartupState] = useState("idle");
  const [startupError, setStartupError] = useState("");
  const [startupProgress, setStartupProgress] = useState([]);

  const videoRef = useRef(null);
  const retainedForSessionRef = useRef(false);

  const dataUrl = CONFIG.FLASK_DATA_URL?.replace(/\/$/, "");
  const syncUrl = CONFIG.FLASK_SYNC_URL?.replace(/\/$/, "");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1920, height: 1080 },
          audio: false,
        });
        if (cancelled) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
        setStream(mediaStream);
        setCameraReady(true);
      } catch {
        if (!cancelled) {
          setCameraError(
            "Camera access denied. Please allow camera in browser settings and refresh the page."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!stream) return;
    return () => {
      if (!retainedForSessionRef.current) {
        stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [stream]);

  useEffect(() => {
    if (!dataUrl) {
      setFlaskReachable(false);
      return;
    }

    let cancelled = false;
    const pollMs = Math.max(10, Number(CONFIG.IMU_POLL_MS) || 20);

    const poll = async () => {
      try {
        const res = await fetch(dataUrl);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setFlaskReachable(true);
          setImuDevices(
            data.devices && typeof data.devices === "object" ? data.devices : {}
          );
        } else {
          setFlaskReachable(false);
        }
      } catch {
        if (!cancelled) {
          setFlaskReachable(false);
        }
      }
    };

    void poll();
    const id = window.setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [dataUrl]);

  const liveKeySet = new Set(Object.keys(imuDevices));
  const hasAtLeastOneActiveLive = CONFIG.SENSOR_SLOTS.some(
    (s) => s.status === "active" && liveKeySet.has(s.id)
  );

  const addStartupStep = (label, ok, details = "") => {
    setStartupProgress((prev) => [...prev, { label, ok, details }]);
  };

  const handleStartSession = async () => {
    if (startupState === "starting") return;
    setStartupState("starting");
    setStartupError("");
    setStartupProgress([]);

    try {
      const hasUser = Boolean((username || metadata?.username || metadata?.name || "").trim());
      if (!hasUser) {
        throw new Error("Missing username. Please complete registration first.");
      }
      addStartupStep("User profile validated", true);

      if (!stream || !cameraReady || cameraError) {
        throw new Error("Camera is not ready.");
      }
      addStartupStep("Camera initialized", true);

      const hasMediaPipe = typeof window.Pose === "function";
      if (!hasMediaPipe) {
        throw new Error("MediaPipe pose model not loaded.");
      }
      addStartupStep("MediaPipe initialized", true);

      if (!hasAtLeastOneActiveLive) {
        throw new Error(
          "At least one expected IMU must be live. Check ESP32 WiFi and Flask bridge."
        );
      }
      addStartupStep("IMU sensors detected", true, `${Object.keys(imuDevices).length} live`);

      const canRecord = typeof MediaRecorder !== "undefined";
      if (!canRecord) {
        throw new Error("MediaRecorder is not available in this browser.");
      }
      addStartupStep("Recording engine initialized", true);

      const canStore = typeof localStorage !== "undefined";
      if (!canStore) {
        throw new Error("Local storage unavailable.");
      }
      addStartupStep("Storage handlers initialized", true);

      let flaskOk = false;
      if (syncUrl) {
        try {
          const ping = await fetch(syncUrl, { method: "OPTIONS" });
          flaskOk = ping.ok || ping.status === 204 || ping.status === 405;
        } catch {
          flaskOk = false;
        }
      }
      addStartupStep("Flask bridge checked", flaskOk || flaskReachable, flaskReachable ? "polling data" : "check network");

      const driveAvailable = Boolean(window.google?.accounts?.oauth2);
      addStartupStep(
        "Drive upload availability checked",
        driveAvailable,
        driveAvailable ? "Google APIs loaded" : "upload can be done later on Review page"
      );

      if (!calibrationDone) {
        throw new Error("Calibration must be confirmed before starting.");
      }
      addStartupStep("Calibration confirmed", true);

      const t0 = Date.now();
      retainedForSessionRef.current = true;
      setTZero(t0);
      setCameraStream(stream);

      if (syncUrl) {
        await fetch(syncUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tZero: t0 }),
        }).catch(() => {});
      }

      setStartupState("ready");
      navigate("/sequencer");
    } catch (err) {
      setStartupState("error");
      setStartupError(err?.message || "Failed to initialize session");
    }
  };

  const systemsReady = cameraReady && calibrationDone && hasAtLeastOneActiveLive;

  const liveCount = Object.keys(imuDevices).length;
  const missingCount = Math.max(0, CONFIG.ACTIVE_SENSOR_COUNT - liveCount);
  const reservedCount = CONFIG.TOTAL_SENSOR_COUNT - CONFIG.ACTIVE_SENSOR_COUNT;

  return (
    <div className="container-fluid py-4">
      <div className="row g-4">
        <div className="col-12 col-lg-7">
          {cameraError ? (
            <div className="alert alert-danger" role="alert">
              {cameraError}
            </div>
          ) : (
            <div
              className="video-container"
              style={{ position: "relative", width: "100%" }}
            >
              <video
                ref={videoRef}
                className="w-100"
                style={{
                  width: "100%",
                  height: "100%",
                  display: "block",
                  objectFit: "cover",
                }}
                muted
                autoPlay
                playsInline
              />
            </div>
          )}
        </div>

        <div className="col-12 col-lg-5">
          <div className="card status-card shadow-sm">
            <div className="card-body">
              <h2 className="h5 card-title mb-2">
                {greeting}, {username || metadata?.name || "participant"}
              </h2>
              <p className="small text-muted mb-0">
                Complete startup checks, then begin the guided sequencing session.
              </p>
            </div>
          </div>

          <div className="card status-card shadow-sm">
            <div className="card-body">
              <h2 className="h5 card-title mb-3">Sensor Status</h2>

              <div className="status-row">
                <span className="fw-medium">Camera</span>
                {cameraReady ? (
                  <span className="badge bg-success">Connected ✓</span>
                ) : cameraError ? (
                  <span className="badge bg-danger">Access Denied ✗</span>
                ) : (
                  <span className="badge bg-secondary">Connecting…</span>
                )}
              </div>

              <div className="status-row">
                <span className="fw-medium">Flask IMU bridge</span>
                {flaskReachable ? (
                  <span className="badge bg-success">Reachable</span>
                ) : (
                  <span className="badge bg-secondary">Not reachable</span>
                )}
              </div>

              <div className="sensor-summary">
                <span className="text-success">
                  🟢 {liveCount} Live
                </span>
                <span className="text-danger ms-3">
                  🔴 {missingCount} Missing
                </span>
                <span className="text-secondary ms-3">
                  ⬜ {reservedCount} Reserved
                </span>
              </div>

              {liveCount < CONFIG.ACTIVE_SENSOR_COUNT && (
                <div className="alert alert-warning mt-2 py-2 mb-0">
                  ⚠ Only {liveCount} of {CONFIG.ACTIVE_SENSOR_COUNT} expected sensors detected.
                  Recording will continue with available sensors only.
                </div>
              )}

              <div className="sensor-grid">
                {CONFIG.SENSOR_SLOTS.map((slot) => {
                  const liveData = imuDevices[slot.id];
                  const isLive = liveData !== undefined;
                  const cardVariant = isLive
                    ? "live"
                    : slot.status === "placeholder"
                      ? "placeholder"
                      : "timeout";
                  const badgeClass = isLive
                    ? "badge-live"
                    : slot.status === "placeholder"
                      ? "badge-placeholder"
                      : "badge-timeout";

                  return (
                    <div
                      key={slot.id}
                      className={`sensor-card sensor-card--${cardVariant}`}
                    >
                      <div className="sensor-card__header">
                        <span className="sensor-id">{slot.label}</span>
                        <span className={`sensor-badge ${badgeClass}`}>
                          {isLive
                            ? "🟢 Live"
                            : slot.status === "placeholder"
                              ? "⬜ Reserved"
                              : "🔴 No signal"}
                        </span>
                      </div>

                      <div className="sensor-body-part">📍 {slot.bodyPart}</div>

                      {isLive && (
                        <div className="sensor-data">
                          <div>
                            🔋{" "}
                            {typeof liveData.soc === "number"
                              ? `${liveData.soc.toFixed(0)}%`
                              : "—"}
                          </div>
                          <div>
                            📶 {liveData.rssi != null ? `${liveData.rssi} dBm` : "—"}
                          </div>
                          <div>
                            qr:{" "}
                            {typeof liveData.qr === "number"
                              ? liveData.qr.toFixed(3)
                              : "—"}
                          </div>
                        </div>
                      )}

                      {slot.status === "placeholder" && (
                        <div className="sensor-placeholder-msg">
                          Sensor not yet available. Flash ESP32 with id &quot;{slot.id}&quot; to
                          activate.
                        </div>
                      )}

                      {slot.status === "active" && !isLive && (
                        <div className="sensor-timeout-msg">
                          Expected sensor not detected. Check ESP32 WiFi connection.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="card status-card shadow-sm">
            <div className="card-body">
              <h2 className="h5 card-title">Pre-Session Calibration</h2>
              <p className="text-muted small mb-3">
                Ask the participant to stand upright facing the camera in Mountain Pose (Tadasana).
                Ensure full body is visible in the frame.
              </p>
              <button
                type="button"
                className="btn btn-success w-100"
                disabled={calibrationDone}
                onClick={() => setCalibrationDone(true)}
              >
                {calibrationDone ? "Calibration Complete ✓" : "Confirm Calibration ✓"}
              </button>
              {calibrationDone ? (
                <p className="small text-success mt-2 mb-0">Ready to begin session</p>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-primary w-100 start-btn"
            disabled={!systemsReady || startupState === "starting"}
            onClick={handleStartSession}
          >
            {startupState === "starting" ? "Starting session..." : "Start Session →"}
          </button>
          <p className="small mt-2 mb-0 text-muted">
            {!cameraReady
              ? "⚠ Camera must be connected"
              : !hasAtLeastOneActiveLive
                ? "⚠ At least one active IMU must be live"
                : !calibrationDone
                  ? "⚠ Calibration must be confirmed"
                  : "✅ All systems ready"}
          </p>
          {startupProgress.length > 0 && (
            <div className="startup-panel mt-3">
              {startupProgress.map((step, idx) => (
                <div key={`${step.label}-${idx}`} className="startup-row">
                  <span>{step.ok ? "✅" : "⚠"}</span>
                  <span className="fw-medium">{step.label}</span>
                  {step.details ? <small className="text-muted">{step.details}</small> : null}
                </div>
              ))}
            </div>
          )}
          {startupState === "error" && startupError ? (
            <div className="alert alert-danger mt-3 py-2 mb-0" role="alert">
              {startupError}
              <button
                type="button"
                className="btn btn-sm btn-outline-danger ms-2"
                onClick={() => {
                  setStartupState("idle");
                  setStartupError("");
                  setStartupProgress([]);
                }}
              >
                Retry
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default HardwarePage;
