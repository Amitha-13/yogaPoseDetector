import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import {
  startRecording,
  stopRecording,
  getTZero,
} from "../utils/recorder";
import { initMediaPipe } from "../utils/mediapipeSetup";
import "./SequencerPage.css";

const RECORDING_DURATION_SEC = 45;

const POSES = [
  { id: "A01", name: "Mountain Pose", sanskrit: "Tadasana" },
  { id: "A02", name: "Tree Pose", sanskrit: "Vrikshasana" },
  { id: "A03", name: "Warrior I", sanskrit: "Virabhadrasana I" },
  { id: "A04", name: "Warrior II", sanskrit: "Virabhadrasana II" },
  { id: "A05", name: "Triangle Pose", sanskrit: "Trikonasana" },
  { id: "A06", name: "Downward Dog", sanskrit: "Adho Mukha Svanasana" },
  { id: "A07", name: "Chair Pose", sanskrit: "Utkatasana" },
  { id: "A08", name: "Cobra Pose", sanskrit: "Bhujangasana" },
  { id: "A09", name: "Bridge Pose", sanskrit: "Setu Bandhasana" },
  { id: "A10", name: "Child's Pose", sanskrit: "Balasana" },
];

function SequencerPage() {
  const navigate = useNavigate();
  const {
    participantId,
    cameraStream,
    sessionRecordings,
    setSessionRecordings,
  } = useSession();

  const [view, setView] = useState("select");
  const [selectedPoseIndex, setSelectedPoseIndex] = useState(null);
  const [recordPhase, setRecordPhase] = useState(null);
  const [getReadyCountdown, setGetReadyCountdown] = useState(3);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [confirmRerecordIndex, setConfirmRerecordIndex] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkBufferRef = useRef([]);
  const mediaPipeCleanupRef = useRef(null);
  const tZeroRef = useRef(null);
  const streamRef = useRef(null);
  const recordingStartRef = useRef(0);
  const recordingCancelRef = useRef(null);
  const selectedPoseIndexRef = useRef(null);
  const wsRef = useRef(null);

  useEffect(() => {
    // Live Data Bridge: Initialize WebSocket connection to backend
    const ws = new WebSocket("ws://localhost:5001/ws/landmarks");
    ws.onopen = () => console.log("Landmark WebSocket connected");
    ws.onerror = (e) => console.error("Landmark WebSocket error", e);
    ws.onclose = () => console.log("Landmark WebSocket closed");
    wsRef.current = ws;

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    };
  }, []);

  useEffect(() => {
    selectedPoseIndexRef.current = selectedPoseIndex;
  }, [selectedPoseIndex]);

  useEffect(() => {
    streamRef.current = cameraStream;
    if (view !== "record" || !videoRef.current || !cameraStream) return;
    videoRef.current.srcObject = cameraStream;
    void videoRef.current.play().catch(() => {
      // Playback can be blocked briefly while browser finalizes media state.
    });
  }, [cameraStream, view]);

  const isPoseRecorded = useCallback(
    (poseName) =>
      sessionRecordings.some(
        (r) =>
          r.poseName === poseName &&
          !r.skipped &&
          r.videoBlob != null
      ),
    [sessionRecordings]
  );

  const recordedCount = POSES.filter((p) => isPoseRecorded(p.name)).length;

  const upsertSessionRecording = useCallback(
    (entry) => {
      setSessionRecordings((prev) => {
        const filtered = prev.filter((r) => r.poseName !== entry.poseName);
        const next = [...filtered, entry];
        next.sort(
          (a, b) => (a.poseIndex ?? 0) - (b.poseIndex ?? 0)
        );
        return next;
      });
    },
    [setSessionRecordings]
  );

  const playStartCue = useCallback(() => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = 1000;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.32, ctx.currentTime + 0.28);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      osc.onended = () => {
        void ctx.close();
      };
    } catch {
      // Ignore blocked/unsupported audio; recording still starts.
    }
  }, []);

  const beginRecordingFlow = useCallback((poseIndex) => {
    setSelectedPoseIndex(poseIndex);
    setView("record");
    setRecordPhase("getReady");
    setGetReadyCountdown(3);
    setRecordingSeconds(0);
    landmarkBufferRef.current = [];
  }, []);

  const handlePoseCardClick = useCallback(
    (poseIndex) => {
      const pose = POSES[poseIndex];
      if (isPoseRecorded(pose.name)) {
        setConfirmRerecordIndex(poseIndex);
        return;
      }
      beginRecordingFlow(poseIndex);
    },
    [isPoseRecorded, beginRecordingFlow]
  );

  const confirmRerecordYes = useCallback(() => {
    if (confirmRerecordIndex == null) return;
    const idx = confirmRerecordIndex;
    setConfirmRerecordIndex(null);
    beginRecordingFlow(idx);
  }, [confirmRerecordIndex, beginRecordingFlow]);

  const cleanupRecordingArtifacts = useCallback(async () => {
    recordingCancelRef.current?.();
    recordingCancelRef.current = null;
    if (mediaPipeCleanupRef.current) {
      mediaPipeCleanupRef.current();
      mediaPipeCleanupRef.current = null;
    }
    await stopRecording();
  }, []);

  const handleBackToList = useCallback(async () => {
    if (recordPhase === "recording") {
      await cleanupRecordingArtifacts();
    } else if (recordPhase === "getReady") {
      /* timeouts cleared by effect cleanup */
    }
    setView("select");
    setRecordPhase(null);
    setSelectedPoseIndex(null);
  }, [recordPhase, cleanupRecordingArtifacts]);

  useEffect(() => {
    if (view !== "record" || recordPhase !== "getReady") return;
    if (!cameraStream) return;

    setGetReadyCountdown(3);
    const t1 = window.setTimeout(() => setGetReadyCountdown(2), 1000);
    const t2 = window.setTimeout(() => setGetReadyCountdown(1), 2000);
    const t3 = window.setTimeout(() => {
      playStartCue();
      recordingStartRef.current = Date.now();
      startRecording(streamRef.current);
      setRecordPhase("recording");
    }, 3000);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [view, recordPhase, selectedPoseIndex, cameraStream, playStartCue]);

  useEffect(() => {
    if (view !== "record" || recordPhase !== "recording") return;
    if (!cameraStream) return;

    const poseIndex = selectedPoseIndexRef.current;
    if (poseIndex == null) return;
    const pose = POSES[poseIndex];
    const duration = RECORDING_DURATION_SEC;
    let cancelled = false;

    landmarkBufferRef.current = [];
    tZeroRef.current = getTZero() ?? recordingStartRef.current ?? Date.now();

    const initHandle = requestAnimationFrame(() => {
      if (cancelled) return;
      if (videoRef.current && canvasRef.current) {
        try {
          mediaPipeCleanupRef.current = initMediaPipe(
            videoRef.current,
            canvasRef.current,
            (frameData) => landmarkBufferRef.current.push(frameData),
            tZeroRef.current,
            (rawLandmarks) => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify(rawLandmarks));
              }
            }
          );
        } catch {
          /* MediaPipe CDN may be blocked */
        }
      }
    });

    setRecordingSeconds(0);
    const start = Date.now();
    const tick = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      setRecordingSeconds(Math.min(elapsed, duration));
    }, 200);

    const end = window.setTimeout(async () => {
      if (cancelled) return;
      window.clearInterval(tick);
      if (mediaPipeCleanupRef.current) {
        mediaPipeCleanupRef.current();
        mediaPipeCleanupRef.current = null;
      }
      const poseLandmarks = [...landmarkBufferRef.current];

      const { videoBlob, imuPackets, tZero } = await stopRecording();
      const recordingStartTime = recordingStartRef.current;
      const poseStart = recordingStartTime - tZero;
      const poseEnd = poseStart + duration * 1000;
      const poseIMU = imuPackets.filter(
        (p) =>
          p.relative_timestamp >= poseStart &&
          p.relative_timestamp <= poseEnd
      );

      upsertSessionRecording({
        poseId: pose.id,
        poseIndex,
        poseName: pose.name,
        sanskrit: pose.sanskrit,
        videoBlob,
        imuPackets: poseIMU,
        landmarks: poseLandmarks,
        frameCount: poseLandmarks.length,
        recordedAt: new Date().toISOString(),
        duration,
        skipped: false,
      });

      setRecordPhase("saved");
    }, duration * 1000);

    recordingCancelRef.current = () => {
      cancelled = true;
      window.clearInterval(tick);
      window.clearTimeout(end);
    };

    return () => {
      cancelled = true;
      cancelAnimationFrame(initHandle);
      if (mediaPipeCleanupRef.current) {
        mediaPipeCleanupRef.current();
        mediaPipeCleanupRef.current = null;
      }
      recordingCancelRef.current = null;
      window.clearInterval(tick);
      window.clearTimeout(end);
    };
  }, [view, recordPhase, cameraStream, upsertSessionRecording]);

  useEffect(() => {
    if (recordPhase !== "saved") return;
    const id = window.setTimeout(() => {
      setView("select");
      setRecordPhase(null);
      setSelectedPoseIndex(null);
    }, 1500);
    return () => window.clearTimeout(id);
  }, [recordPhase]);

  const durationSec = RECORDING_DURATION_SEC;
  const remainingRecording = Math.max(0, durationSec - recordingSeconds);
  const selectedPose =
    selectedPoseIndex != null ? POSES[selectedPoseIndex] : null;

  if (!cameraStream) {
    return (
      <div className="sequencer-fullscreen sequencer-padding">
        <div className="sequencer-alert sequencer-alert-danger">
          Camera stream not available. Use Start Session from the hardware
          setup page first.
        </div>
      </div>
    );
  }

  return (
    <div className="sequencer-fullscreen">
      {confirmRerecordIndex != null ? (
        <div
          className="sequencer-dialog-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rerecord-title"
        >
          <div className="sequencer-dialog">
            <p id="rerecord-title" className="sequencer-dialog-text">
              This pose was already recorded. Re-record it?
            </p>
            <div className="sequencer-dialog-actions">
              <button
                type="button"
                className="sequencer-btn sequencer-btn-secondary"
                onClick={() => setConfirmRerecordIndex(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sequencer-btn sequencer-btn-primary"
                onClick={confirmRerecordYes}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {view === "select" ? (
        <div className="container-fluid py-4 sequencer-select-view">
          <div className="sequencer-select-header px-3">
            <div />
            <div className="sequencer-counter badge bg-light text-dark border">
              {recordedCount} of 10 poses recorded
            </div>
          </div>

          <div className="sequencer-select-intro">
            <h1 className="sequencer-heading">Select a Pose to Record</h1>
            <p className="sequencer-subheading">
              Choose any pose from the list below. You can record each pose
              independently.
            </p>
          </div>

          <div className="row g-4 px-3">
            {POSES.map((p, i) => {
              const recorded = isPoseRecorded(p.name);
              return (
                <div key={p.id} className="col-12 col-md-6 col-lg-4">
                  <button
                    type="button"
                    className={`w-100 sequencer-pose-card${recorded ? " sequencer-pose-card-recorded" : ""}`}
                    onClick={() => handlePoseCardClick(i)}
                  >
                    <div className="d-flex align-items-center flex-wrap gap-2">
                      <span className="sequencer-pose-card-name">{p.name}</span>
                      <span className="text-muted">·</span>
                      <span className="sequencer-pose-card-sanskrit">{p.sanskrit}</span>
                      <span className="text-muted">·</span>
                      <span
                        className={`sequencer-badge${recorded ? " sequencer-badge-recorded" : " sequencer-badge-pending"}`}
                      >
                        {recorded ? "Recorded ✓" : "Not recorded"}
                      </span>
                    </div>
                  </button>
                </div>
              );
            })}
          </div>

          <div className="sequencer-select-footer mt-5">
            <button
              type="button"
              className="btn btn-success sequencer-btn-finish"
              disabled={recordedCount < 1}
              onClick={() => navigate("/review")}
            >
              Finish Session →
            </button>
          </div>
        </div>
      ) : (
        <div className="sequencer-record-root">
          <div
            className={
              recordPhase === "recording" || recordPhase === "saved"
                ? "sequencer-video-wrap sequencer-video-wrap-full"
                : "sequencer-video-wrap"
            }
          >
            <video
              ref={videoRef}
              className={
                recordPhase === "recording" || recordPhase === "saved"
                  ? "sequencer-video-bg"
                  : "sequencer-video-preview"
              }
              autoPlay
              playsInline
              muted
            />
            <canvas
              ref={canvasRef}
              className={
                recordPhase === "recording"
                  ? "sequencer-canvas-overlay"
                  : "sequencer-canvas-hidden"
              }
              aria-hidden
            />
          </div>

          <div
            className={
              recordPhase === "recording" || recordPhase === "saved"
                ? "sequencer-record-overlay sequencer-record-overlay-full"
                : "sequencer-record-overlay"
            }
          >
            <div className="sequencer-record-top">
              <button
                type="button"
                className="sequencer-btn sequencer-btn-back"
                onClick={() => void handleBackToList()}
              >
                ← Back to pose list
              </button>
            </div>

            <div className="sequencer-record-title-block">
              <h2 className="sequencer-heading-record">{selectedPose?.name}</h2>
              <p className="sequencer-sanskrit-record">{selectedPose?.sanskrit}</p>
            </div>

            {recordPhase === "getReady" && (
              <div className="sequencer-phase-block">
                <p className="sequencer-get-ready-msg">
                  Get into position for {selectedPose?.name}
                </p>
                <div
                  key={`cd-${getReadyCountdown}-${selectedPoseIndex}`}
                  className="sequencer-countdown-number"
                >
                  {getReadyCountdown}
                </div>
              </div>
            )}

            {recordPhase === "recording" && (
              <div className="sequencer-recording-ui">
                <div className="sequencer-rec-top">
                  <span className="sequencer-rec-badge">
                    <span className="sequencer-rec-dot" aria-hidden />
                    REC
                  </span>
                </div>
                <div className="sequencer-rec-spacer" />
                <div className="sequencer-rec-bottom">
                  <p className="sequencer-rec-label">Recording...</p>
                  <p className="sequencer-rec-remaining">
                    {remainingRecording}s remaining
                  </p>
                  <div className="sequencer-recording-progress">
                    <div
                      className="sequencer-recording-progress-fill"
                      style={{
                        width: `${Math.min(
                          100,
                          (recordingSeconds / durationSec) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {recordPhase === "saved" && (
              <div className="sequencer-phase-block">
                <div className="sequencer-saved-banner">
                  Saved ✓
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SequencerPage;
