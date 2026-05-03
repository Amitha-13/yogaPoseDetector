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

const POSES = [
  { id: "A01", name: "Mountain Pose", sanskrit: "Tadasana", duration: 30 },
  { id: "A02", name: "Tree Pose", sanskrit: "Vrikshasana", duration: 30 },
  { id: "A03", name: "Warrior I", sanskrit: "Virabhadrasana I", duration: 30 },
  { id: "A04", name: "Warrior II", sanskrit: "Virabhadrasana II", duration: 30 },
  { id: "A05", name: "Triangle Pose", sanskrit: "Trikonasana", duration: 30 },
  { id: "A06", name: "Downward Dog", sanskrit: "Adho Mukha Svanasana", duration: 30 },
  { id: "A07", name: "Chair Pose", sanskrit: "Utkatasana", duration: 30 },
  { id: "A08", name: "Cobra Pose", sanskrit: "Bhujangasana", duration: 30 },
  { id: "A09", name: "Bridge Pose", sanskrit: "Setu Bandhasana", duration: 30 },
  { id: "A10", name: "Child's Pose", sanskrit: "Balasana", duration: 30 },
];

function SequencerPage() {
  const navigate = useNavigate();
  const { participantId, setSessionRecordings: commitSessionToContext } =
    useSession();

  const [currentPoseIndex, setCurrentPoseIndex] = useState(0);
  const [phase, setPhase] = useState("prepare");
  const [countdown, setCountdown] = useState(3);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [sessionRecordings, setSessionRecordings] = useState([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkBufferRef = useRef([]);
  const mediaPipeCleanupRef = useRef(null);
  const tZeroRef = useRef(null);
  const streamRef = useRef(null);
  const prepareTimeoutRef = useRef(null);
  const recordingStartRef = useRef(0);
  const recordingCancelRef = useRef(null);
  const poseIndexRef = useRef(0);

  useEffect(() => {
    poseIndexRef.current = currentPoseIndex;
  }, [currentPoseIndex]);

  useEffect(() => {
    let cancelled = false;
    let mediaStream = null;

    (async () => {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 1920, height: 1080 },
          audio: false,
        });
        if (cancelled) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = mediaStream;
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
        setCameraReady(true);
      } catch {
        if (!cancelled) {
          setCameraError(
            "Camera unavailable. Allow camera access and refresh the page."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
      }
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (mediaPipeCleanupRef.current) {
        mediaPipeCleanupRef.current();
        mediaPipeCleanupRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (phase !== "prepare" || !cameraReady) return;
    const id = window.setTimeout(() => setPhase("countdown"), 3000);
    prepareTimeoutRef.current = id;
    return () => {
      window.clearTimeout(id);
      if (prepareTimeoutRef.current === id) prepareTimeoutRef.current = null;
    };
  }, [phase, currentPoseIndex, cameraReady]);

  useEffect(() => {
    if (phase !== "countdown" || !cameraReady) return;
    setCountdown(3);
    const t1 = window.setTimeout(() => setCountdown(2), 1000);
    const t2 = window.setTimeout(() => setCountdown(1), 2000);
    const t3 = window.setTimeout(() => {
      recordingStartRef.current = Date.now();
      startRecording(streamRef.current);
      setPhase("recording");
    }, 3000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
  }, [phase, currentPoseIndex, cameraReady]);

  useEffect(() => {
    if (phase !== "recording" || !cameraReady) return;

    const pose = POSES[currentPoseIndex];
    const duration = pose.duration;
    let cancelled = false;

    landmarkBufferRef.current = [];
    tZeroRef.current = getTZero() ?? recordingStartRef.current ?? Date.now();

    let initHandle = requestAnimationFrame(() => {
      if (cancelled) return;
      if (videoRef.current && canvasRef.current) {
        try {
          mediaPipeCleanupRef.current = initMediaPipe(
            videoRef.current,
            canvasRef.current,
            (frameData) => landmarkBufferRef.current.push(frameData),
            tZeroRef.current
          );
        } catch (_) {
          /* MediaPipe CDN may be blocked or slow to load */
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
          p.relative_timestamp >= poseStart && p.relative_timestamp <= poseEnd
      );

      setSessionRecordings((prev) => [
        ...prev,
        {
          poseId: pose.id,
          poseIndex: currentPoseIndex,
          poseName: pose.name,
          sanskrit: pose.sanskrit,
          videoBlob,
          imuPackets: poseIMU,
          landmarks: poseLandmarks,
          frameCount: poseLandmarks.length,
          recordedAt: new Date().toISOString(),
          duration,
          skipped: false,
        },
      ]);
      setPhase("saved");
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
  }, [phase, currentPoseIndex, cameraReady]);

  useEffect(() => {
    if (phase !== "saved") return;
    const id = window.setTimeout(() => {
      if (currentPoseIndex >= POSES.length - 1) {
        setPhase("complete");
      } else {
        setCurrentPoseIndex((i) => i + 1);
        setPhase("prepare");
        setCountdown(3);
        setRecordingSeconds(0);
      }
    }, 1500);
    return () => window.clearTimeout(id);
  }, [phase, currentPoseIndex]);

  useEffect(() => {
    if (phase !== "complete") return;
    commitSessionToContext(sessionRecordings);
  }, [phase, sessionRecordings, commitSessionToContext]);

  const addSkippedClip = useCallback((idx) => {
    const p = POSES[idx];
    setSessionRecordings((prev) => [
      ...prev,
      {
        poseId: p.id,
        poseIndex: idx,
        poseName: p.name,
        sanskrit: p.sanskrit,
        videoBlob: null,
        imuPackets: [],
        skipped: true,
        recordedAt: new Date().toISOString(),
      },
    ]);
  }, []);

  const advanceAfterSkip = useCallback((idx) => {
    if (idx >= POSES.length - 1) {
      setPhase("complete");
    } else {
      setCurrentPoseIndex(idx + 1);
      setPhase("prepare");
      setCountdown(3);
      setRecordingSeconds(0);
    }
  }, []);

  const handleSkipPose = useCallback(async () => {
    const idx = poseIndexRef.current;
    if (phase === "prepare") {
      if (prepareTimeoutRef.current != null) {
        window.clearTimeout(prepareTimeoutRef.current);
        prepareTimeoutRef.current = null;
      }
      addSkippedClip(idx);
      advanceAfterSkip(idx);
    } else if (phase === "recording") {
      if (mediaPipeCleanupRef.current) {
        mediaPipeCleanupRef.current();
        mediaPipeCleanupRef.current = null;
      }
      recordingCancelRef.current?.();
      recordingCancelRef.current = null;
      await stopRecording();
      addSkippedClip(idx);
      advanceAfterSkip(idx);
    }
  }, [phase, addSkippedClip, advanceAfterSkip]);

  const pose = POSES[currentPoseIndex];
  const recordedCount = sessionRecordings.filter((r) => !r.skipped).length;
  const skippedCount = sessionRecordings.filter((r) => r.skipped).length;

  const approxTotalMb =
    sessionRecordings.reduce(
      (acc, r) => acc + (r.videoBlob?.size ?? 0),
      0
    ) +
    sessionRecordings.reduce(
      (acc, r) => acc + new Blob([JSON.stringify(r.imuPackets || [])]).size,
      0
    );
  const totalMbDisplay = (approxTotalMb / (1024 * 1024)).toFixed(2);

  if (cameraError) {
    return (
      <div className="sequencer-fullscreen p-4">
        <div className="alert alert-danger">{cameraError}</div>
      </div>
    );
  }

  if (phase === "complete") {
    return (
      <div className="sequencer-fullscreen py-5 px-3">
        <div className="text-center mb-4">
          <h1 className="display-5 fw-bold">Session Complete! 🎉</h1>
          <p className="text-white-50 mb-1 small">Participant ID</p>
          <p className="font-monospace">{participantId}</p>
          <p className="text-white-50 small">
            {new Date().toLocaleString()}
          </p>
        </div>

        <div className="table-responsive sequencer-complete-table mb-4">
          <table className="table table-dark table-striped table-bordered align-middle">
            <thead>
              <tr>
                <th>Pose name</th>
                <th>Sanskrit</th>
                <th>Status</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {sessionRecordings.map((r) => (
                <tr key={`${r.poseId}-${r.poseIndex}-${r.recordedAt}`}>
                  <td>{r.poseName}</td>
                  <td className="fst-italic">{r.sanskrit}</td>
                  <td>{r.skipped ? "⏭ Skipped" : "✅ Recorded"}</td>
                  <td>{r.skipped ? "—" : `${r.duration ?? 8}s`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="text-center mb-4 text-white-50">
          <p className="mb-1">Recorded: {recordedCount} poses</p>
          <p className="mb-1">Skipped: {skippedCount} pose(s)</p>
          <p className="mb-0">Total data: approx {totalMbDisplay} MB</p>
        </div>

        <div className="text-center">
          <button
            type="button"
            className="btn btn-primary btn-lg px-5"
            onClick={() => navigate("/review")}
          >
            Upload to Google Drive →
          </button>
        </div>
      </div>
    );
  }

  const durationSec = pose.duration;
  const remainingRecording = Math.max(0, durationSec - recordingSeconds);

  return (
    <div className="sequencer-fullscreen">
      <div
        style={
          phase === "recording"
            ? { position: "fixed", inset: 0, zIndex: 0, margin: 0, padding: 0 }
            : { position: "relative", width: "100%" }
        }
      >
        <video
          ref={videoRef}
          className={
            phase === "recording"
              ? "video-background"
              : "sequencer-video-hidden"
          }
          autoPlay
          playsInline
          muted
        />
        {phase === "recording" ? (
          <canvas
            ref={canvasRef}
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
        ) : null}
      </div>

      <div className="overlay-content d-flex flex-column flex-grow-1">
        <div className="sequencer-top-bar w-100">
          <div className="progress-dots mb-0 py-0">
            {POSES.map((p, i) => (
              <div
                key={p.id}
                className={`dot ${
                  i < currentPoseIndex
                    ? "completed"
                    : i === currentPoseIndex
                      ? "current"
                      : ""
                }`}
                title={p.name}
              />
            ))}
          </div>
          <div className="text-center flex-grow-1">
            <span className="fw-semibold">
              Pose {currentPoseIndex + 1} of {POSES.length}
            </span>
          </div>
          <div className="small text-white-50 font-monospace">
            {participantId}
          </div>
        </div>

        {phase === "prepare" && (
          <div className="pose-display">
            <h2 className="pose-name">{pose.name}</h2>
            <p className="pose-sanskrit">{pose.sanskrit}</p>
            <p className="lead text-white-50">Get Ready...</p>
            <p className="small text-white-50">
              Pose {currentPoseIndex + 1} of {POSES.length}
            </p>
            <button
              type="button"
              className="btn btn-outline-light mt-4"
              onClick={handleSkipPose}
            >
              Skip Pose
            </button>
          </div>
        )}

        {phase === "countdown" && (
          <div className="pose-display">
            <h2 className="pose-name">{pose.name}</h2>
            <p className="pose-sanskrit">{pose.sanskrit}</p>
            <div
              key={`cd-${countdown}-${currentPoseIndex}`}
              className="countdown-number"
            >
              {countdown}
            </div>
          </div>
        )}

        {phase === "recording" && (
          <div className="flex-grow-1 d-flex flex-column position-relative px-3 pb-4">
            <div className="d-flex justify-content-between align-items-start pt-3">
              <span className="rec-badge">
                <span className="rec-dot" aria-hidden />
                REC
              </span>
              <span className="text-white fw-semibold">
                Pose {currentPoseIndex + 1} of {POSES.length}
              </span>
            </div>
            <div className="flex-grow-1" />
            <div className="text-center">
              <p className="text-white mb-2">Recording...</p>
              <p className="small text-white-50 mb-2">
                {remainingRecording} second
                {remainingRecording !== 1 ? "s" : ""} remaining
              </p>
              <div className="recording-progress mx-auto">
                <div
                  className="recording-progress-fill"
                  style={{
                    width: `${Math.min(100, (recordingSeconds / durationSec) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <div className="text-end mt-3">
              <button
                type="button"
                className="btn btn-outline-light"
                onClick={handleSkipPose}
              >
                Skip Pose
              </button>
            </div>
          </div>
        )}

        {phase === "saved" && (
          <div className="pose-display">
            <div className="alert alert-success mb-0 d-inline-block">
              <strong>✓ Saved!</strong> {pose.name}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default SequencerPage;
