import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import CONFIG from "../config";
import "./HardwarePage.css";

const DEFAULT_BACKEND_WS = "ws://localhost:5001";
const DEFAULT_BACKEND_REST = "http://localhost:5001";

function HardwarePage() {
  const navigate = useNavigate();
  const { setTZero, setCameraStream, participantId, metadata, username, greeting } = useSession();

  const [stream, setStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [backendStatus, setBackendStatus] = useState("disconnected");
  const [imuMode, setImuMode] = useState("synthetic");
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [packetCount, setPacketCount] = useState(0);
  const [moduleStatus, setModuleStatus] = useState({});
  const [moduleCount, setModuleCount] = useState(0);
  const [startupState, setStartupState] = useState("idle");
  const [startupError, setStartupError] = useState("");
  const [startupProgress, setStartupProgress] = useState([]);

  const videoRef = useRef(null);
  const backendWsRef = useRef(null);
  const retainedForSessionRef = useRef(false);
  const packetTotalRef = useRef(0);
  const syntheticWorkerRef = useRef(null);

  const backendWsUrl = CONFIG.BACKEND_WS_URL ?? DEFAULT_BACKEND_WS;
  const backendRestUrl = CONFIG.BACKEND_REST_URL ?? DEFAULT_BACKEND_REST;

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
    const ws = new WebSocket(`${backendWsUrl.replace(/\/$/, "")}/ws`);
    backendWsRef.current = ws;

    ws.onopen = () => {
      setBackendStatus("connected");
      setImuMode("backend");
      packetTotalRef.current = 0;
      setPacketCount(0);
      setModuleStatus({});
      setModuleCount(0);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "status") {
          const modules = msg.modules || {};
          setModuleStatus(modules);
          setModuleCount(msg.moduleCount ?? Object.keys(modules).length);
        } else if (msg.type === "frame") {
          packetTotalRef.current += 1;
          const n = packetTotalRef.current;
          if (n % 10 === 0) {
            setPacketCount(n);
          }
        }
      } catch {
        // Ignore malformed backend frames
      }
    };

    ws.onerror = () => {
      setBackendStatus("disconnected");
      setImuMode("synthetic");
    };

    ws.onclose = () => {
      setBackendStatus("disconnected");
      setImuMode("synthetic");
    };

    return () => {
      if (backendWsRef.current) {
        backendWsRef.current.close();
        backendWsRef.current = null;
      }
    };
  }, [backendWsUrl]);

  useEffect(() => {
    if (imuMode !== "synthetic") {
      if (syntheticWorkerRef.current) {
        try {
          syntheticWorkerRef.current.postMessage({ type: "STOP" });
        } catch {
          /* ignore */
        }
        syntheticWorkerRef.current = null;
      }
      return;
    }

    packetTotalRef.current = 0;
    setPacketCount(0);

    const worker = new Worker(
      new URL("../workers/imuWorker.js", import.meta.url)
    );
    syntheticWorkerRef.current = worker;
    const t0 = Date.now();
    worker.postMessage({ type: "START", tZero: t0 });

    worker.onmessage = () => {
      packetTotalRef.current += 1;
      const n = packetTotalRef.current;
      if (n % 50 === 0) {
        setPacketCount(n);
      }
    };

    return () => {
      if (syntheticWorkerRef.current === worker) {
        try {
          worker.postMessage({ type: "STOP" });
        } catch {
          /* ignore */
        }
        syntheticWorkerRef.current = null;
      }
    };
  }, [imuMode]);

  const addStartupStep = (label, ok, details = "") => {
    setStartupProgress((prev) => [...prev, { label, ok, details }]);
  };

  const handleStartSession = async () => {
    if (startupState === "starting") return;
    setStartupState("starting");
    setStartupError("");
    setStartupProgress([]);

    try {
      // 1) Validate user/session metadata
      const hasUser = Boolean((username || metadata?.username || metadata?.name || "").trim());
      if (!hasUser) {
        throw new Error("Missing username. Please complete registration first.");
      }
      addStartupStep("User profile validated", true);

      // 2) Camera availability
      if (!stream || !cameraReady || cameraError) {
        throw new Error("Camera is not ready.");
      }
      addStartupStep("Camera initialized", true);

      // 3) MediaPipe readiness
      const hasMediaPipe = typeof window.Pose === "function";
      if (!hasMediaPipe) {
        throw new Error("MediaPipe pose model not loaded.");
      }
      addStartupStep("MediaPipe initialized", true);

      // 4) Sensor check (backend or fallback worker)
      const sensorsReady = imuMode === "backend" || packetCount > 0;
      if (!sensorsReady) {
        throw new Error("Sensors are not streaming yet.");
      }
      addStartupStep("Sensors initialized", true, imuMode === "backend" ? "backend stream" : "synthetic fallback");

      // 5) Recording prerequisites
      const canRecord = typeof MediaRecorder !== "undefined";
      if (!canRecord) {
        throw new Error("MediaRecorder is not available in this browser.");
      }
      addStartupStep("Recording engine initialized", true);

      // 6) Storage handlers (local)
      const canStore = typeof localStorage !== "undefined";
      if (!canStore) {
        throw new Error("Local storage unavailable.");
      }
      addStartupStep("Storage handlers initialized", true);

      // 7) Backend connectivity check (non-blocking)
      let backendReachable = false;
      try {
        const pingRes = await fetch(`${backendRestUrl.replace(/\/$/, "")}/session/start`, {
          method: "OPTIONS",
        });
        backendReachable = pingRes.ok || pingRes.status === 204 || pingRes.status === 404;
      } catch {
        backendReachable = false;
      }
      addStartupStep("Backend connectivity checked", backendReachable, backendReachable ? "reachable" : "will run in fallback mode");

      // 8) Drive availability check (non-blocking)
      const driveAvailable = Boolean(window.google?.accounts?.oauth2);
      addStartupStep("Drive upload availability checked", driveAvailable, driveAvailable ? "Google APIs loaded" : "upload can be done later on Review page");

      if (!calibrationDone) {
        throw new Error("Calibration must be confirmed before starting.");
      }
      addStartupStep("Calibration confirmed", true);

      const t0 = Date.now();
      retainedForSessionRef.current = true;
      setTZero(t0);
      setCameraStream(stream);

      await fetch(`${backendRestUrl.replace(/\/$/, "")}/session/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          participantId,
          participantName: metadata?.name || username || "participant",
          sessionId: `session_${Date.now()}`,
        }),
      }).catch(() => {
        // Backend may be down; sequencer can still run with fallback.
      });

      setStartupState("ready");
      navigate("/sequencer");
    } catch (err) {
      setStartupState("error");
      setStartupError(err?.message || "Failed to initialize session");
    }
  };

  const systemsReady = cameraReady && calibrationDone;

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
                <div>
                  <div className="fw-medium">IMU Data</div>
                  <div className="small text-muted">
                    Aggregated frames: {packetCount}
                  </div>
                </div>
                {imuMode === "backend" ? (
                  <span className="badge bg-success">{moduleCount} modules connected</span>
                ) : (
                  <span className="badge bg-warning text-dark">
                    Synthetic fallback
                  </span>
                )}
              </div>

              <div className="status-row">
                <span className="fw-medium">Backend</span>
                {backendStatus === "connected" ? (
                  <span className="badge bg-success">Connected</span>
                ) : (
                  <span className="badge bg-secondary">
                    Not connected (fallback mode)
                  </span>
                )}
              </div>

              {Object.entries(moduleStatus).length > 0 ? (
                <div className="mt-3">
                  {Object.entries(moduleStatus).map(([id, mod]) => (
                    <div key={id} className="d-flex justify-content-between small mb-1">
                      <span>
                        #{id} {mod.bodyPart || `Module ${id}`}
                      </span>
                      <span>
                        SOC {mod.soc ?? "--"}% | RSSI {mod.rssi ?? "--"} dBm
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="card status-card shadow-sm">
            <div className="card-body">
              <h2 className="h5 card-title">Pre-Session Calibration</h2>
              <p className="text-muted small mb-3">
                Ask the participant to stand upright facing the camera in
                Mountain Pose (Tadasana). Ensure full body is visible in the
                frame.
              </p>
              <button
                type="button"
                className="btn btn-success w-100"
                disabled={calibrationDone}
                onClick={() => setCalibrationDone(true)}
              >
                {calibrationDone
                  ? "Calibration Complete ✓"
                  : "Confirm Calibration ✓"}
              </button>
              {calibrationDone ? (
                <p className="small text-success mt-2 mb-0">
                  Ready to begin session
                </p>
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
