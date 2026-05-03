import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import CONFIG from "../config";
import "./HardwarePage.css";

const DEFAULT_ESP32_WS = "ws://192.168.1.100:81";

function HardwarePage() {
  const navigate = useNavigate();
  const { setTZero, setCameraStream } = useSession();

  const [stream, setStream] = useState(null);
  const [cameraError, setCameraError] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [esp32Status, setEsp32Status] = useState("disconnected");
  const [imuMode, setImuMode] = useState("synthetic");
  const [calibrationDone, setCalibrationDone] = useState(false);
  const [packetCount, setPacketCount] = useState(0);

  const videoRef = useRef(null);
  const wsRef = useRef(null);
  const retainedForSessionRef = useRef(false);
  const packetTotalRef = useRef(0);
  const syntheticWorkerRef = useRef(null);

  const wsUrl = CONFIG.ESP32_WS_URL ?? DEFAULT_ESP32_WS;

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
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setEsp32Status("connected");
      setImuMode("real");
      packetTotalRef.current = 0;
      setPacketCount(0);
    };

    ws.onmessage = (event) => {
      let pkt = null;
      try {
        pkt = JSON.parse(event.data);
      } catch {
        pkt = { raw: event.data };
      }
      if (pkt && typeof pkt === "object") {
        packetTotalRef.current += 1;
        const n = packetTotalRef.current;
        if (n % 50 === 0) {
          setPacketCount(n);
        }
      }
    };

    ws.onerror = () => {
      setEsp32Status("disconnected");
      setImuMode("synthetic");
    };

    ws.onclose = () => {
      setEsp32Status("disconnected");
      setImuMode("synthetic");
    };

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [wsUrl]);

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
    navigate("/sequencer");
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
            <div className="video-container">
              <video
                ref={videoRef}
                className="w-100"
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
                    Packets: {packetCount}
                  </div>
                </div>
                {imuMode === "real" ? (
                  <span className="badge bg-success">ESP32 Live</span>
                ) : (
                  <span className="badge bg-warning text-dark">
                    Synthetic 50Hz
                  </span>
                )}
              </div>

              <div className="status-row">
                <span className="fw-medium">ESP32</span>
                {esp32Status === "connected" ? (
                  <span className="badge bg-success">Connected</span>
                ) : (
                  <span className="badge bg-secondary">
                    Not connected (optional)
                  </span>
                )}
              </div>
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
