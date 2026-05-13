import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import CONFIG from "../config";
import "./HardwarePage.css";

const DEFAULT_BACKEND_WS = "ws://localhost:5001";
const DEFAULT_BACKEND_REST = "http://localhost:5001";

function HardwarePage() {
  const navigate = useNavigate();
  const { setTZero, setCameraStream, participantId, metadata } = useSession();

  const [stream, setStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [backendStatus, setBackendStatus] = useState("disconnected");
  const [imuMode, setImuMode] = useState("synthetic");
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [packetCount, setPacketCount] = useState(0);
  const [moduleStatus, setModuleStatus] = useState({});
  const [moduleCount, setModuleCount] = useState(0);

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

  const handleStartSession = () => {
    if (!stream || !cameraReady || !calibrationDone) return;
    const t0 = Date.now();
    retainedForSessionRef.current = true;
    setTZero(t0);
    setCameraStream(stream);
    fetch(`${backendRestUrl.replace(/\/$/, "")}/session/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        participantId,
        participantName: metadata?.name || "participant",
        sessionId: `session_${Date.now()}`,
      }),
    })
      .catch(() => {
        // Backend may be down; sequencer can still run with fallback.
      })
      .finally(() => navigate("/sequencer"));
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
            disabled={!systemsReady}
            onClick={handleStartSession}
          >
            Start Session →
          </button>
          <p className="small mt-2 mb-0 text-muted">
            {!cameraReady
              ? "⚠ Camera must be connected"
              : !calibrationDone
                ? "⚠ Calibration must be confirmed"
                : "✅ All systems ready"}
          </p>
        </div>
      </div>
    </div>
  );
}

export default HardwarePage;
