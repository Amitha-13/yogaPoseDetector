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
  // ── STANDING POSES ──────────────────────────
  {
    id: "STA-01",
    name: "Mountain Pose",
    sanskrit: "Tadasana",
    category: "Standing",
    duration: 45,
  },
  {
    id: "STA-02",
    name: "Tree Pose",
    sanskrit: "Vrksasana",
    category: "Standing",
    duration: 45,
  },
  {
    id: "STA-03",
    name: "Hand-to-Foot Pose",
    sanskrit: "Padahastasana",
    category: "Standing",
    duration: 45,
  },
  {
    id: "STA-04-I",
    name: "Half Wheel Pose",
    sanskrit: "Ardha Chakrasana",
    category: "Standing",
    duration: 45,
    variation: "Variation I",
  },
  {
    id: "STA-04-II",
    name: "Half Waist Wheel Pose",
    sanskrit: "Ardha Katichakrasana",
    category: "Standing",
    duration: 45,
    variation: "Variation II of STA-04",
  },
  {
    id: "STA-05-I",
    name: "Triangle Pose",
    sanskrit: "Trikonasana",
    category: "Standing",
    duration: 45,
    variation: "Variation I",
  },
  {
    id: "STA-05-II",
    name: "Revolved Triangle Pose",
    sanskrit: "Parivritta Trikonasana",
    category: "Standing",
    duration: 45,
    variation: "Variation II of STA-05",
  },

  // ── SITTING POSES ───────────────────────────
  {
    id: "SIA-01",
    name: "Half Camel Pose",
    sanskrit: "Ardha Ustrasana",
    category: "Sitting",
    duration: 45,
  },
  {
    id: "SIA-02",
    name: "Twisted Pose",
    sanskrit: "Vakrasana",
    category: "Sitting",
    duration: 45,
  },

  // ── PRONE POSES ─────────────────────────────
  {
    id: "PR-01",
    name: "Crocodile Pose",
    sanskrit: "Makarasana",
    category: "Prone",
    duration: 45,
  },
  {
    id: "PR-02",
    name: "Cobra Pose",
    sanskrit: "Bhujangasana",
    category: "Prone",
    duration: 45,
  },

  // ── SUPINE POSES ────────────────────────────
  {
    id: "SU-01",
    name: "Half Plough Pose",
    sanskrit: "Ardha Halasana",
    category: "Supine",
    duration: 45,
  },
  {
    id: "SU-02",
    name: "Corpse Pose",
    sanskrit: "Savasana",
    category: "Supine",
    duration: 45,
  },
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

    const v = videoRef.current;

    if (v && cameraStream) {
      v.srcObject = cameraStream;

      const playAttempt = v.play();

      if (playAttempt !== undefined) {
        playAttempt.catch(() => {
          /* autoplay policies */
        });
      }
    }
  }, [cameraStream]);

  useEffect(() => {
    if (view !== "record" || !cameraStream) return;

    const v = videoRef.current;
    if (!v) return;

    v.srcObject = cameraStream;

    const playAttempt = v.play();

    if (playAttempt !== undefined) {
      playAttempt.catch(() => {});
    }
  }, [view, recordPhase, cameraStream]);

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

  const recordedCount = POSES.filter((p) =>
    isPoseRecorded(p.name)
  ).length;

  const upsertSessionRecording = useCallback(
    (entry) => {
      setSessionRecordings((prev) => {
        const filtered = prev.filter(
          (r) => r.poseName !== entry.poseName
        );

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
      const AudioCtx =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = "sine";
      osc.frequency.value = 1000;

      gain.gain.setValueAtTime(
        0.0001,
        ctx.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        0.35,
        ctx.currentTime + 0.03
      );

      gain.gain.exponentialRampToValueAtTime(
        0.32,
        ctx.currentTime + 0.28
      );

      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        ctx.currentTime + 0.5
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.5);

      osc.onended = () => {
        void ctx.close();
      };
    } catch {
      // ignore audio errors
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
    }

    setView("select");
    setRecordPhase(null);
    setSelectedPoseIndex(null);
  }, [recordPhase, cleanupRecordingArtifacts]);

  useEffect(() => {
    if (view !== "record" || recordPhase !== "getReady")
      return;

    if (!cameraStream) return;

    setGetReadyCountdown(3);

    const t1 = window.setTimeout(
      () => setGetReadyCountdown(2),
      1000
    );

    const t2 = window.setTimeout(
      () => setGetReadyCountdown(1),
      2000
    );

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
  }, [
    view,
    recordPhase,
    selectedPoseIndex,
    cameraStream,
    playStartCue,
  ]);

  useEffect(() => {
    if (
      view !== "record" ||
      recordPhase !== "recording"
    )
      return;

    if (!cameraStream) return;

    const poseIndex = selectedPoseIndexRef.current;

    if (poseIndex == null) return;

    const pose = POSES[poseIndex];
    const duration = RECORDING_DURATION_SEC;

    let cancelled = false;

    landmarkBufferRef.current = [];

    tZeroRef.current =
      getTZero() ??
      recordingStartRef.current ??
      Date.now();

    const initHandle = requestAnimationFrame(() => {
      if (cancelled) return;
      if (videoRef.current && canvasRef.current) {
        try {
          mediaPipeCleanupRef.current = initMediaPipe(
            videoRef.current,
            canvasRef.current,
            (frameData) => landmarkBufferRef.current.push(frameData),
            tZeroRef.current
          );
        } catch {
          /* MediaPipe CDN may be blocked */
        }
      }
    });

    setRecordingSeconds(0);

    const start = Date.now();

    const tick = window.setInterval(() => {
      const elapsed = Math.floor(
        (Date.now() - start) / 1000
      );

      setRecordingSeconds(
        Math.min(elapsed, duration)
      );
    }, 200);

    const end = window.setTimeout(async () => {
      if (cancelled) return;

      window.clearInterval(tick);

      if (mediaPipeCleanupRef.current) {
        mediaPipeCleanupRef.current();
        mediaPipeCleanupRef.current = null;
      }

      const poseLandmarks = [
        ...landmarkBufferRef.current,
      ];

      const {
        videoBlob,
        imuPackets,
        tZero,
      } = await stopRecording();

      const recordingStartTime =
        recordingStartRef.current;

      const poseStart =
        recordingStartTime - tZero;

      const poseEnd =
        poseStart + duration * 1000;

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

      videoReadyAbort?.abort();

      cancelAnimationFrame(initHandle);

      if (mediaPipeCleanupRef.current) {
        mediaPipeCleanupRef.current();
        mediaPipeCleanupRef.current = null;
      }

      recordingCancelRef.current = null;

      window.clearInterval(tick);
      window.clearTimeout(end);
    };
  }, [
    view,
    recordPhase,
    cameraStream,
    upsertSessionRecording,
  ]);

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

  const remainingRecording = Math.max(
    0,
    durationSec - recordingSeconds
  );

  const selectedPose =
    selectedPoseIndex != null
      ? POSES[selectedPoseIndex]
      : null;

  const currentPoseIndex = selectedPoseIndex;

  if (!cameraStream) {
    return (
      <div className="sequencer-fullscreen sequencer-padding">
        <div className="sequencer-alert sequencer-alert-danger">
          Camera stream not available. Use Start Session
          from the hardware setup page first.
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
            <p
              id="rerecord-title"
              className="sequencer-dialog-text"
            >
              This pose was already recorded.
              Re-record it?
            </p>

            <div className="sequencer-dialog-actions">
              <button
                type="button"
                className="sequencer-btn sequencer-btn-secondary"
                onClick={() =>
                  setConfirmRerecordIndex(null)
                }
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
            <div className="sequencer-counter">
              {recordedCount} of 10 poses recorded
            </div>
          </div>

          <div className="sequencer-select-intro">
            <h1 className="sequencer-heading">
              Select a Pose to Record
            </h1>

            <p className="sequencer-subheading">
              Choose any pose from the list below.
              You can record each pose independently.
            </p>
            <p className="sequencer-participant-id">{participantId}</p>
          </div>

          <div className="row g-4 px-3">
            {POSES.map((p, i) => {
              const recorded = isPoseRecorded(
                p.name
              );

              return (
                <button
                  key={p.id}
                  type="button"
                  className={`sequencer-pose-card${recorded ? " sequencer-pose-card-recorded" : ""}`}
                  onClick={() => handlePoseCardClick(i)}
                >
                  <span className="sequencer-pose-card-name">{p.name}</span>
                  <span className="sequencer-pose-card-sanskrit">{p.sanskrit}</span>
                  <span
                    className={`sequencer-badge${recorded ? " sequencer-badge-recorded" : " sequencer-badge-pending"}`}
                  >
                    {recorded ? "Recorded ✓" : "Not recorded"}
                  </span>
                </button>
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
              recordPhase === "recording" ||
              recordPhase === "saved"
                ? "sequencer-video-wrap sequencer-video-wrap-full"
                : "sequencer-video-wrap"
            }
            style={{ position: "relative", width: "100%" }}
          >
            <video
              ref={videoRef}
              className={
                recordPhase === "recording" ||
                recordPhase === "saved"
                  ? "sequencer-video-bg"
                  : "sequencer-video-preview"
              }
              style={{
                width: "100%",
                height: "100%",
                display: "block",
                objectFit: "cover",
              }}
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
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
              aria-hidden
            />
          </div>

          <div
            className={
              recordPhase === "recording" ||
              recordPhase === "saved"
                ? "sequencer-record-overlay sequencer-record-overlay-full"
                : "sequencer-record-overlay"
            }
          >
            <div className="sequencer-record-top">
              <button
                type="button"
                className="sequencer-btn sequencer-btn-back"
                onClick={() =>
                  void handleBackToList()
                }
              >
                ← Back to pose list
              </button>
            </div>

            <div className="sequencer-record-title-block">
              {recordPhase === "getReady" &&
              currentPoseIndex != null ? (
                <>
                  <div className="pose-category-label">
                    {POSES[currentPoseIndex].category}{" "}
                    Pose
                  </div>

                  <div className="pose-code">
                    {POSES[currentPoseIndex].id}
                  </div>

                  <div className="pose-name">
                    {POSES[currentPoseIndex].name}
                  </div>

                  <div className="pose-sanskrit">
                    {POSES[currentPoseIndex].sanskrit}
                  </div>

                  {POSES[currentPoseIndex].variation && (
                    <div className="pose-variation">
                      {POSES[currentPoseIndex].variation}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <h2 className="sequencer-heading-record">
                    {selectedPose?.name}
                  </h2>

                  <p className="sequencer-sanskrit-record">
                    {selectedPose?.sanskrit}
                  </p>
                </>
              )}
            </div>

            {recordPhase === "getReady" && (
              <div className="sequencer-phase-block">
                <p className="sequencer-get-ready-msg">
                  Get into position for{" "}
                  {selectedPose?.name}
                </p>

                {currentPoseIndex != null ? (
                  <p
                    className="sequencer-pose-progress-text"
                    style={{
                      margin: "0 0 12px",
                      fontSize: "0.95rem",
                      fontWeight: 600,
                      opacity: 0.85,
                    }}
                  >
                    Pose {currentPoseIndex + 1} of 13
                  </p>
                ) : null}

                {currentPoseIndex != null ? (
                  <div
                    className="sequencer-pose-progress-dots"
                    style={{
                      display: "flex",
                      gap: 6,
                      justifyContent: "center",
                      flexWrap: "wrap",
                      marginBottom: 20,
                    }}
                  >
                    {POSES.map((_, i) => (
                      <span
                        key={POSES[i].id}
                        aria-hidden
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background:
                            i === currentPoseIndex
                              ? "#f59e0b"
                              : "rgba(255,255,255,0.25)",
                        }}
                      />
                    ))}
                  </div>
                ) : null}

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
                    <span
                      className="sequencer-rec-dot"
                      aria-hidden
                    />
                    REC
                  </span>
                </div>

                <div className="sequencer-rec-spacer" />

                <div className="sequencer-rec-bottom">
                  <p className="sequencer-rec-label">
                    Recording...
                  </p>

                  <p className="sequencer-rec-remaining">
                    {remainingRecording}s remaining
                  </p>

                  <div className="sequencer-recording-progress">
                    <div
                      className="sequencer-recording-progress-fill"
                      style={{
                        width: `${Math.min(
                          100,
                          (recordingSeconds /
                            durationSec) *
                            100
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