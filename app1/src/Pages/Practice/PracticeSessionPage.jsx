import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import CONFIG from "../../config";
import { usePractice } from "../../context/PracticeContext";
import { usePracticePoseDetection } from "../../hooks/usePracticePoseDetection";
import { startRecording, stopRecording } from "../../utils/recorder";
import { createSessionZip } from "../../utils/sessionExport";
import { checkRecorderHealth } from "../../utils/sessionRecorderApi";
import "./PracticeSessionPage.css";

const confidenceTone = (pct) => {
  if (pct > 80) return "practice-session__detected--good";
  if (pct >= 50) return "practice-session__detected--warn";
  return "practice-session__detected--bad";
};

const MAX_RECORDING_SECONDS = 180;

const PracticeSessionPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const pose = location.state?.pose;

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);
  const recordingRef = useRef(null);
  const elapsedRef = useRef(0);

  const {
    setSelectedPose,
    detectedPose,
    confidence,
    corrections,
    setIsSessionActive,
    setDetectedPose,
    setConfidence,
    setCorrections,
  } = usePractice();

  const [cameraError, setCameraError] = useState(null);
  const [sessionPhase, setSessionPhase] = useState("idle");
  const [countdownValue, setCountdownValue] = useState(3);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordingData, setRecordingData] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [backendReady, setBackendReady] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const playBuzzer = useCallback(() => {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      oscillator.type = "square";
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      oscillator.start(ctx.currentTime);
      oscillator.stop(ctx.currentTime + 0.4);
    } catch (e) {
      console.warn("Buzzer sound failed:", e);
    }
  }, []);

  const finalizeRecording = useCallback(
    async (reason = "manual") => {
      window.clearInterval(timerRef.current);
      window.clearInterval(countdownRef.current);
      timerRef.current = null;
      countdownRef.current = null;
      setIsSessionActive(false);

      const duration = Math.max(1, elapsedRef.current || 1);
      let videoBlob = null;
      let storedOffline = false;

      if (recordingRef.current) {
        const result = await stopRecording({
          poseId: pose?.id,
          poseName: pose?.name,
          persistOffline: false,
        });
        videoBlob = result.videoBlob;
        storedOffline = result.storedOffline;
        recordingRef.current = null;
      }

      const entry = {
        poseId: pose.id,
        poseName: pose.name,
        sanskrit: pose.sanskrit,
        category: pose.category || "general",
        variation: pose.variation || "",
        videoBlob: storedOffline ? null : videoBlob,
        imuPackets: [],
        landmarks: [],
        storedOffline: Boolean(storedOffline),
        recordedAt: new Date().toISOString(),
        duration,
        skipped: false,
      };

      setRecordingData(entry);
      setSessionPhase("done");
      stopCamera();

      if (reason === "timeout") {
        setDetectedPose("—");
        setConfidence(0);
      }
    },
    [pose, setConfidence, setDetectedPose, setIsSessionActive, stopCamera]
  );

  const stopSession = useCallback(
    (reason = "manual") => {
      void finalizeRecording(reason);
    },
    [finalizeRecording]
  );

  const startRecordingTimer = useCallback(() => {
    elapsedRef.current = 0;
    timerRef.current = window.setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSeconds(elapsedRef.current);
      if (elapsedRef.current >= MAX_RECORDING_SECONDS) {
        void finalizeRecording("timeout");
      }
    }, 1000);
  }, [finalizeRecording]);

  const initCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: false,
      });
      streamRef.current = stream;
      setCameraError(null);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      return stream;
    } catch (e) {
      setCameraError(
        e?.message ||
          "Camera access was denied or is unavailable. Allow camera permission to practice."
      );
      setSessionPhase("idle");
      setIsSessionActive(false);
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
      return null;
    }
  }, [setIsSessionActive]);

  const beginRecording = useCallback(async () => {
    if (!pose || sessionPhase !== "idle") return;

    setCameraError(null);
    setSaveStatus(null);
    setRecordingData(null);
    setSessionPhase("countdown");
    setCountdownValue(3);
    setDetectedPose(null);
    setConfidence(0);
    setCorrections([]);

    const stream = streamRef.current || (await initCamera());
    if (!stream) {
      setSessionPhase("idle");
      return;
    }

    let count = 3;
    countdownRef.current = window.setInterval(() => {
      count -= 1;
      setCountdownValue(count);
      if (count <= 0) {
        window.clearInterval(countdownRef.current);
        countdownRef.current = null;
        playBuzzer();

        void (async () => {
          startRecording(stream, { persistOffline: false });
          recordingRef.current = true;
          setIsSessionActive(true);
          setSessionPhase("recording");
          elapsedRef.current = 0;
          setElapsedSeconds(0);
          startRecordingTimer();
        })();
      }
    }, 1000);
  }, [
    pose,
    sessionPhase,
    backendReady,
    setCorrections,
    setConfidence,
    setDetectedPose,
    setIsSessionActive,
    initCamera,
    playBuzzer,
    startRecordingTimer,
  ]);

  useEffect(() => {
    if (!pose) {
      navigate("/practice", { replace: true });
    }
  }, [pose, navigate]);

  useEffect(() => {
    if (!pose) return;

    setSelectedPose(pose);
    setDetectedPose(null);
    setConfidence(0);
    setCorrections([]);

    void initCamera();

    let cancelled = false;
    (async () => {
      const ok = await checkRecorderHealth();
      if (cancelled) return;
      setBackendReady(ok);
    })();

    return () => {
      cancelled = true;
      stopCamera();
      setIsSessionActive(false);
      setSelectedPose(null);
      setDetectedPose(null);
      setConfidence(0);
      setCorrections([]);
      window.clearInterval(timerRef.current);
      window.clearInterval(countdownRef.current);
    };
  }, [
    pose,
    setSelectedPose,
    setIsSessionActive,
    setDetectedPose,
    setConfidence,
    setCorrections,
    initCamera,
    stopCamera,
  ]);

  const poseDetectionEnabled =
    !cameraError && !!pose && (sessionPhase === "recording" || sessionPhase === "idle");

  const { mediapipeError } = usePracticePoseDetection({
    videoRef,
    canvasRef,
    enabled: poseDetectionEnabled,
    practicePoseName: pose?.name ?? "",
    setDetectedPose,
    setConfidence,
    setCorrections,
  });

  const remaining = Math.max(0, MAX_RECORDING_SECONDS - elapsedSeconds);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeDisplay = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  const progressPercent = (elapsedSeconds / MAX_RECORDING_SECONDS) * 100;

  const handleDownload = async () => {
    if (!recordingData) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const { zipBlob, zipFileName } = await createSessionZip(
        recordingData,
        { username: "practice_user", sessionNumber: 1 },
        `practice_${Date.now()}`
      );
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = zipFileName;
      a.click();
      URL.revokeObjectURL(url);
      setSaveStatus({ ok: true, message: "Download started." });
    } catch (err) {
      setSaveStatus({ ok: false, message: err?.message || "Download failed." });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveToDevice = async () => {
    if (!recordingData) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const dirHandle = await window.showDirectoryPicker({
        mode: "readwrite",
        startIn: "downloads",
      });
      const { zipBlob, zipFileName } = await createSessionZip(
        recordingData,
        { username: "practice_user", sessionNumber: 1 },
        `practice_${Date.now()}`
      );
      const fileHandle = await dirHandle.getFileHandle(zipFileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(zipBlob);
      await writable.close();
      setSaveStatus({ ok: true, message: `Saved to device as ${zipFileName}` });
    } catch (err) {
      if (err?.name === "AbortError") {
        setSaveStatus({ ok: false, message: "Save cancelled." });
      } else {
        setSaveStatus({ ok: false, message: err?.message || "Save failed." });
      }
    } finally {
      setSaving(false);
    }
  };

  if (!pose) {
    return null;
  }

  const confidencePct = Math.round(typeof confidence === "number" ? confidence : 0);

  return (
    <div className="practice-session container-fluid py-4">
      <div className="row g-4 align-items-stretch">
        <div className="col-12 col-lg-7">
          <div className="practice-session__video-wrap">
            {cameraError ? (
              <div className="practice-session__camera-error alert alert-warning mb-0">
                {cameraError}
              </div>
            ) : (
              <>
                {mediapipeError ? (
                  <div className="practice-session__camera-error alert alert-danger mb-2 py-2 small">
                    Pose model: {mediapipeError}
                  </div>
                ) : null}
                <div
                  className="practice-session__video-inner"
                  style={{ position: "relative", width: "100%" }}
                >
                  <video
                    ref={videoRef}
                    className="practice-session__video"
                    muted
                    autoPlay
                    playsInline
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "block",
                      objectFit: "cover",
                    }}
                  />
                  <canvas
                    ref={canvasRef}
                    className="practice-session__canvas"
                    aria-hidden
                  />
                  {sessionPhase === "countdown" && (
                    <div className="practice-countdown-overlay">
                      <div className="practice-countdown-number">
                        {countdownValue > 0 ? countdownValue : 1}
                      </div>
                      <div className="practice-countdown-label">Get ready...</div>
                    </div>
                  )}
                  {sessionPhase === "recording" && (
                    <div className="practice-recording-overlay">
                      <div className="practice-timer-display">
                        <span className="practice-rec-badge">● REC</span>
                        <span className="practice-timer-text">{timeDisplay}</span>
                      </div>
                      <div className="practice-progress-bar">
                        <div
                          className="practice-progress-fill"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <button
                        className="practice-stop-btn"
                        onClick={() => stopSession("manual")}
                        type="button"
                      >
                        ■ Stop Recording
                      </button>
                      <div className="practice-max-note">Maximum 3 minutes per pose</div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="col-12 col-lg-5">
          <div className="practice-session__panel card h-100 shadow-sm">
            <div className="card-body d-flex flex-column gap-3">
              <div>
                <h1 className="h4 mb-1">{pose.name}</h1>
                <p className="text-muted fst-italic small mb-0">{pose.sanskrit}</p>
              </div>

              {sessionPhase !== "done" && (
                <>
                  <div
                    className={`practice-session__detected p-3 rounded border ${confidenceTone(
                      confidencePct
                    )}`}
                  >
                    <div className="small text-uppercase text-muted mb-1">Detected Pose</div>
                    <div className="fw-semibold">{detectedPose ?? "—"}</div>
                    <div className="mt-1">Confidence: {confidencePct}%</div>
                  </div>

                  <div className="practice-session__corrections p-3 rounded border bg-light">
                    <div className="small text-uppercase text-muted mb-1">Corrections</div>
                    {corrections.length === 0 ? (
                      <p className="mb-0 small text-success">
                        No major adjustments needed for the tracked joints.
                      </p>
                    ) : (
                      <ul className="mb-0 small ps-3 practice-session__correction-list">
                        {corrections.map((c, i) => (
                          <li key={`${i}-${c}`}>{c}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              <div className="practice-session__timer text-center py-3 border rounded">
                {sessionPhase === "idle" ? (
                  <>
                    <div className="small text-muted">Ready to record</div>
                    <div className="display-6 fw-semibold">3:00</div>
                  </>
                ) : sessionPhase === "countdown" ? (
                  <>
                    <div className="small text-muted">Starting soon</div>
                    <div className="display-6 fw-semibold">
                      {countdownValue > 0 ? countdownValue : 1}s
                    </div>
                  </>
                ) : sessionPhase === "recording" ? (
                  <>
                    <div className="small text-muted">Remaining time</div>
                    <div className="display-6 fw-semibold">{timeDisplay}</div>
                  </>
                ) : (
                  <>
                    <div className="small text-muted">Recording complete</div>
                    <div className="display-6 fw-semibold text-success">✓ Saved</div>
                  </>
                )}
              </div>

              {sessionPhase === "done" && recordingData && (
                <div className="practice-save-panel p-3 rounded border bg-light">
                  <div className="small text-uppercase text-muted mb-2">Save Recording</div>
                  <div className="d-grid gap-2">
                    <button
                      type="button"
                      className="btn btn-success"
                      disabled={saving}
                      onClick={() => void handleDownload()}
                    >
                      Download ZIP
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-primary"
                      disabled={saving}
                      onClick={() => void handleSaveToDevice()}
                    >
                      Save to Device Folder
                    </button>
                  </div>
                  {saveStatus && (
                    <div
                      className={`small mt-2 ${saveStatus.ok ? "text-success" : "text-danger"}`}
                    >
                      {saveStatus.message}
                    </div>
                  )}
                </div>
              )}

              {sessionPhase === "idle" ? (
                <button
                  type="button"
                  className="btn btn-danger mt-auto fw-semibold"
                  onClick={() => void beginRecording()}
                >
                  ● Start Recording
                </button>
              ) : sessionPhase === "recording" || sessionPhase === "countdown" ? (
                <button
                  type="button"
                  className="btn btn-outline-secondary mt-auto"
                  onClick={() => {
                    if (sessionPhase === "countdown") {
                      window.clearInterval(countdownRef.current);
                      countdownRef.current = null;
                      setSessionPhase("idle");
                      setIsSessionActive(false);
                    } else {
                      stopSession("manual");
                    }
                  }}
                >
                  Cancel
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-outline-secondary mt-auto"
                  onClick={() => navigate("/practice")}
                >
                  Exit Practice
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PracticeSessionPage;
