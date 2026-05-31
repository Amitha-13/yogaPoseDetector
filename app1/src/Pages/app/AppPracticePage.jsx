import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { POSES } from "../../data/poses";
import { useAuth } from "../../context/AuthContext";
import { useSession } from "../../context/SessionContext";
import { useAppCollectionPose } from "../../hooks/useAppCollectionPose";
import AppImuStatusStrip from "../../Components/app/AppImuStatusStrip";
import CONFIG from "../../config";
import { countActiveOnline, normalizeImuPollPayload } from "../../utils/sensorStatus";
import { playCountdownBeep } from "../../utils/countdownBeep";
import { startRecording, stopRecording } from "../../utils/recorder";
import "../../Pages/SequencerPage.css";
import "../../Pages/Practice/PracticeSessionPage.css";
import "./AppPages.css";

const API_BASE = "http://127.0.0.1:3001";
const MAX_RECORDING_SECONDS = 180;
const categories = ["All", "Standing", "Sitting", "Prone", "Supine"];

const fmt = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

const AppPracticePage = () => {
  const navigate = useNavigate();
  const { token, currentUser } = useAuth();
  const {
    sessionId,
    posePracticeCounts,
    incrementPoseCount,
    clearSession,
    cameraStream,
    tZero: sessionTZero,
    metadata,
  } = useSession();

  const [categoryFilter, setCategoryFilter] = useState("All");
  const [selectedPoseId, setSelectedPoseId] = useState("");
  const [statsRows, setStatsRows] = useState([]);
  const [view, setView] = useState("grid");
  const [recordPhase, setRecordPhase] = useState("idle");
  const [countdownValue, setCountdownValue] = useState(3);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [summary, setSummary] = useState(null);
  const [imuDevices, setImuDevices] = useState({});
  const [detectedPose, setDetectedPose] = useState("—");
  const [confidence, setConfidence] = useState(0);
  const [corrections, setCorrections] = useState([]);
  const [saveResult, setSaveResult] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const ownedStreamRef = useRef(false);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);
  const elapsedRef = useRef(0);
  const selectedPoseIdRef = useRef(selectedPoseId);

  const selectedPose = useMemo(
    () => POSES.find((p) => p.id === selectedPoseId) || null,
    [selectedPoseId]
  );

  const visiblePoses = useMemo(
    () => (categoryFilter === "All" ? POSES : POSES.filter((p) => p.category === categoryFilter)),
    [categoryFilter]
  );

  const groupedVisiblePoses = useMemo(
    () =>
      visiblePoses.reduce((acc, pose) => {
        if (!acc[pose.category]) acc[pose.category] = [];
        acc[pose.category].push(pose);
        return acc;
      }, {}),
    [visiblePoses]
  );

  useEffect(() => {
    selectedPoseIdRef.current = selectedPoseId;
  }, [selectedPoseId]);

  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/practices/user/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok) setStatsRows(data.rows || []);
      } catch {
        setStatsRows([]);
      }
    })();
  }, [token, view]);

  useEffect(() => {
    const dataUrl = CONFIG.FLASK_DATA_URL?.replace(/\/$/, "");
    if (!dataUrl) return undefined;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`${dataUrl}/debug/imu`, { cache: "no-store" });
        if (!res.ok) throw new Error("down");
        const data = await res.json();
        if (!cancelled) setImuDevices(normalizeImuPollPayload(data, CONFIG.SENSOR_SLOTS));
      } catch {
        if (!cancelled) setImuDevices({});
      }
    };
    void poll();
    const id = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);


  const posePipelineEnabled =
    view === "practice" &&
    Boolean(selectedPose) &&
    cameraReady &&
    recordPhase !== "done";

  const { mediapipeError } = useAppCollectionPose({
    videoRef,
    canvasRef,
    enabled: posePipelineEnabled,
    practicePoseName: selectedPose?.name || "",
    setDetectedPose,
    setConfidence,
    setCorrections,
  });

  const attachStream = useCallback((stream) => {
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      const play = videoRef.current.play();
      if (play?.catch) play.catch(() => {});
    }
    setCameraReady(true);
  }, []);

  useEffect(() => {
    if (view !== "practice" || !selectedPose) return undefined;

    let cancelled = false;

    if (cameraStream) {
      attachStream(cameraStream);
      ownedStreamRef.current = false;
      return () => {
        if (!cancelled && ownedStreamRef.current) {
          streamRef.current?.getTracks().forEach((t) => t.stop());
        }
      };
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1920, height: 1080 },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        ownedStreamRef.current = true;
        attachStream(stream);
      } catch {
        if (!cancelled) setCameraReady(false);
      }
    })();

    return () => {
      cancelled = true;
      if (ownedStreamRef.current) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        ownedStreamRef.current = false;
      }
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraReady(false);
    };
  }, [view, selectedPoseId, cameraStream, attachStream, selectedPose]);

  const clearTimers = useCallback(() => {
    window.clearInterval(timerRef.current);
    window.clearInterval(countdownRef.current);
    timerRef.current = null;
    countdownRef.current = null;
  }, []);

  const finalizeRecording = useCallback(
    async (stoppedBy) => {
      if (!selectedPose || stopping) return;
      setStopping(true);
      clearTimers();

      const duration = Math.max(1, elapsedRef.current || 1);
      let saveError = null;

      try {
        if (streamRef.current) {
          await stopRecording({
            poseId: selectedPose.id,
            poseName: selectedPose.name,
            persistOffline: false,
          });
        }

        if (sessionId && token) {
          try {
            await fetch(`${API_BASE}/api/practices`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({
                session_id: sessionId,
                pose_name: selectedPose.name,
                pose_sanskrit: selectedPose.sanskrit,
                pose_category: selectedPose.category,
                started_at: new Date(Date.now() - duration * 1000).toISOString(),
                ended_at: new Date().toISOString(),
                duration_seconds: duration,
                stopped_by: stoppedBy,
              }),
            });
          } catch {
            /* app stats are optional */
          }
        }

        incrementPoseCount(selectedPose.name);
        setSaveResult({
          ok: !saveError,
          storedOffline: false,
          duration,
          error: saveError,
        });
        setRecordPhase("done");
      } finally {
        setStopping(false);
      }
    },
    [
      selectedPose,
      stopping,
      clearTimers,
      currentUser,
      metadata,
      sessionId,
      token,
      incrementPoseCount,
    ]
  );

  const startRecordingTimer = useCallback(() => {
    elapsedRef.current = 0;
    setElapsedSec(0);
    timerRef.current = window.setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSec(elapsedRef.current);
      if (elapsedRef.current >= MAX_RECORDING_SECONDS) {
        void finalizeRecording("timer");
      }
    }, 1000);
  }, [finalizeRecording]);

  const beginCountdown = useCallback(() => {
    if (!selectedPose || !streamRef.current || recordPhase !== "idle") return;

    setSaveResult(null);
    setRecordPhase("countdown");
    setCountdownValue(3);
    playCountdownBeep();

    let count = 3;
    countdownRef.current = window.setInterval(() => {
      count -= 1;
      if (count > 0) {
        setCountdownValue(count);
        playCountdownBeep();
        return;
      }

      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
      setCountdownValue(0);
      playCountdownBeep({ final: true });

      void (async () => {
        startRecording(streamRef.current, {
          sessionTZero: sessionTZero ?? undefined,
          persistOffline: false,
        });
        setRecordPhase("recording");
        startRecordingTimer();
      })();
    }, 1000);
  }, [selectedPose, recordPhase, sessionTZero, startRecordingTimer]);

  const openPose = (poseId) => {
    clearTimers();
    setSelectedPoseId(poseId);
    setRecordPhase("idle");
    setElapsedSec(0);
    elapsedRef.current = 0;
    setSaveResult(null);
    setDetectedPose("—");
    setConfidence(0);
    setCorrections([]);
    setView("practice");
  };

  const backToGrid = () => {
    clearTimers();
    setView("grid");
    setRecordPhase("idle");
    setSaveResult(null);
  };

  const endSession = async () => {
    if (!sessionId) return;
    await fetch(`${API_BASE}/api/sessions/${sessionId}/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const sessionRes = await fetch(`${API_BASE}/api/practices/session/${sessionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const sessionData = await sessionRes.json();
    const byPose = sessionData.by_pose || [];
    const entries = byPose.map((row) => [row.pose_name, row.total_count]);
    const totalSeconds = (sessionData.practices || []).reduce(
      (acc, practice) => acc + Number(practice.duration_seconds || 0),
      0
    );
    setSummary({ entries, totalSeconds });
  };

  const lifetimeCount = (name) =>
    Number(statsRows.find((r) => r.pose_name === name)?.total_count || 0);

  if (!sessionId) {
    return (
      <div className="app-shell container py-4">
        <div className="alert alert-warning">No active session. Start from hardware checks.</div>
        <button className="btn btn-outline-dark" type="button" onClick={() => navigate("/app/hardware")}>
          Go to Hardware
        </button>
      </div>
    );
  }

  const connectedCount = countActiveOnline(imuDevices, CONFIG.SENSOR_SLOTS);
  const remaining = Math.max(0, MAX_RECORDING_SECONDS - elapsedSec);
  const progressPercent = (elapsedSec / MAX_RECORDING_SECONDS) * 100;

  return (
    <div className="sequencer-fullscreen">
      <AppImuStatusStrip />
      {view === "grid" ? (
        <div className="container-fluid py-4 sequencer-select-view">
          <div className="sequencer-select-intro">
            <h1 className="sequencer-heading">Select a Pose to Practice</h1>
            <p className="sequencer-subheading">
              Choose a pose, then press Start Recording when you are ready.
            </p>
          </div>
          <div className="sequencer-filter-row px-3">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`sequencer-filter-btn${categoryFilter === cat ? " active" : ""}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className="sequencer-category-sections px-3">
            {Object.entries(groupedVisiblePoses).map(([category, poses]) => (
              <section key={category} className="sequencer-category-section">
                <h3 className="sequencer-category-title">{category} Poses</h3>
                <div className="sequencer-pose-grid">
                  {poses.map((pose) => {
                    const count = (posePracticeCounts[pose.name] || 0) + lifetimeCount(pose.name);
                    const selected = selectedPoseId === pose.id;
                    return (
                      <button
                        key={pose.id}
                        type="button"
                        className="sequencer-pose-card"
                        style={{
                          borderColor: selected ? "#0ea5e9" : undefined,
                          borderWidth: selected ? 2 : 1,
                        }}
                        onClick={() => openPose(pose.id)}
                      >
                        <span className="sequencer-pose-card-name">{pose.name}</span>
                        <span className="sequencer-pose-card-sanskrit">{pose.sanskrit}</span>
                        <span className="sequencer-pose-meta">{pose.id} · 180s</span>
                        <span
                          className={`sequencer-badge ${
                            count > 0 ? "sequencer-badge-recorded" : "sequencer-badge-pending"
                          }`}
                        >
                          {count > 0 ? `Practiced ${count} times` : "Not practiced"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
          <div className="sequencer-select-footer mt-4">
            <button type="button" className="btn btn-outline-dark" onClick={endSession}>
              End Session
            </button>
          </div>
        </div>
      ) : (
        <div className="app-session-overlay">
          <button type="button" className="btn btn-sm btn-light position-absolute m-3" onClick={backToGrid}>
            ← Back to poses
          </button>

          <div className="position-absolute start-0 top-0 m-3 app-practice-pose-title">
            <h2 className="h4 mb-0">{selectedPose?.name}</h2>
            <div className="fst-italic">{selectedPose?.sanskrit}</div>
          </div>

          <div className="position-absolute end-0 top-0 m-3 px-3 py-2 rounded bg-dark small">
            {connectedCount} IMU connected
          </div>

          {mediapipeError ? (
            <div className="alert alert-warning position-absolute m-3 app-practice-alert">
              MediaPipe: {mediapipeError}
            </div>
          ) : null}

          <div className="app-practice-video-stack">
            <video
              ref={videoRef}
              className="app-practice-video"
              autoPlay
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="app-practice-canvas" aria-hidden />
          </div>

          {recordPhase === "countdown" && (
            <div className="practice-countdown-overlay">
              <div className="practice-countdown-number" key={countdownValue}>
                {countdownValue > 0 ? countdownValue : 1}
              </div>
              <div className="practice-countdown-label">Get ready...</div>
            </div>
          )}

          {recordPhase === "recording" && (
            <div className="practice-recording-overlay">
              <div className="practice-timer-display">
                <span className="practice-rec-badge">● REC</span>
                <span className="practice-timer-text">{fmt(remaining)}</span>
              </div>
              <div className="practice-progress-bar">
                <div
                  className="practice-progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <button
                type="button"
                className="practice-stop-btn"
                onClick={() => void finalizeRecording("manual")}
                disabled={stopping}
              >
                ■ Stop Recording
              </button>
              <div className="practice-max-note">Maximum 3 minutes per pose</div>
            </div>
          )}

          {recordPhase === "done" && saveResult && (
            <div className="app-practice-done-panel">
              <h3 className="h4 text-success mb-2">Recording completed</h3>
              <p className="mb-1">
                <strong>{selectedPose?.name}</strong> — {fmt(saveResult.duration)} recorded
              </p>
              <p className="mb-2 small">
                {saveResult.ok
                  ? "Saved successfully to local session storage."
                  : `Save issue: ${saveResult.error || "Unknown error"}`}
              </p>
              {saveResult.storedOffline && (
                <p className="small text-muted mb-3">
                  Folder: <code>{saveResult.directory}</code>
                  <br />
                  Includes video, landmarks, IMU (if connected), and metadata.
                </p>
              )}
              <div className="d-flex flex-wrap gap-2 justify-content-center">
                <button type="button" className="btn btn-primary" onClick={backToGrid}>
                  Practice another pose
                </button>
              </div>
            </div>
          )}

          {(recordPhase === "idle" || recordPhase === "recording") && (
            <div className="app-practice-side-panel">
              <div className="small mb-1">Detected: {detectedPose}</div>
              <div className="small mb-2">Confidence: {Math.round(confidence)}%</div>
              {corrections.length > 0 ? (
                <div className="small mb-2">{corrections[0]}</div>
              ) : null}
              {recordPhase === "idle" ? (
                <>
                  <div className="app-practice-timer-preview">{fmt(MAX_RECORDING_SECONDS)}</div>
                  <button
                    type="button"
                    className="btn btn-danger btn-lg w-100 fw-semibold"
                    onClick={beginCountdown}
                    disabled={!cameraReady}
                  >
                    ● Start Recording
                  </button>
                </>
              ) : (
                <div className="app-practice-timer-preview">{fmt(remaining)} remaining</div>
              )}
            </div>
          )}
        </div>
      )}

      {summary ? (
        <div className="sequencer-dialog-overlay">
          <div className="sequencer-dialog">
            <h3 className="h5">Great practice!</h3>
            <p className="small mb-1">Total session time: {Math.round(summary.totalSeconds / 60)} min</p>
            {summary.entries.map(([name, count]) => (
              <div key={name} className="small">
                {name}: {count} times
              </div>
            ))}
            <button
              type="button"
              className="btn btn-primary mt-3"
              onClick={() => {
                setSummary(null);
                clearSession();
                navigate("/app/dashboard");
              }}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default AppPracticePage;
