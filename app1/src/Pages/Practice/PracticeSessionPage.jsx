import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { usePractice } from "../../context/PracticeContext";
import { usePracticePoseDetection } from "../../hooks/usePracticePoseDetection";
import "./PracticeSessionPage.css";

const confidenceTone = (pct) => {
  if (pct > 80) return "practice-session__detected--good";
  if (pct >= 50) return "practice-session__detected--warn";
  return "practice-session__detected--bad";
};

const PracticeSessionPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const pose = location.state?.pose;

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

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
  const [remainingSec, setRemainingSec] = useState(
    () => location.state?.pose?.duration ?? 0
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  useEffect(() => {
    if (!pose) {
      navigate("/practice", { replace: true });
    }
  }, [pose, navigate]);

  useEffect(() => {
    if (!pose) return;

    setSelectedPose(pose);
    setIsSessionActive(true);
    setRemainingSec(pose.duration);
    setDetectedPose(null);
    setConfidence(0);
    setCorrections([]);

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        setCameraError(null);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (e) {
        if (!cancelled) {
          setCameraError(
            e?.message ||
              "Camera access was denied or is unavailable. Allow camera permission to practice."
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
      setIsSessionActive(false);
      setSelectedPose(null);
      setDetectedPose(null);
      setConfidence(0);
      setCorrections([]);
    };
  }, [
    pose,
    setSelectedPose,
    setIsSessionActive,
    setDetectedPose,
    setConfidence,
    setCorrections,
    stopCamera,
  ]);

  const poseDetectionEnabled = !cameraError && !!pose;

  const { mediapipeError } = usePracticePoseDetection({
    videoRef,
    canvasRef,
    enabled: poseDetectionEnabled,
    practicePoseName: pose?.name ?? "",
    setDetectedPose,
    setConfidence,
    setCorrections,
  });

  useEffect(() => {
    if (!pose) return;
    const id = window.setInterval(() => {
      setRemainingSec((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [pose]);

  const handleStop = () => {
    stopCamera();
    navigate("/practice");
  };

  if (!pose) {
    return null;
  }

  const confidencePct = Math.round(
    typeof confidence === "number" ? confidence : 0
  );

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
                <div className="practice-session__video-inner">
                  <video
                    ref={videoRef}
                    className="practice-session__video"
                    muted
                    autoPlay
                    playsInline
                  />
                  <canvas
                    ref={canvasRef}
                    className="practice-session__canvas"
                    aria-hidden
                  />
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

              <div
                className={`practice-session__detected p-3 rounded border ${confidenceTone(
                  confidencePct
                )}`}
              >
                <div className="small text-uppercase text-muted mb-1">
                  Detected Pose
                </div>
                <div className="fw-semibold">
                  {detectedPose ?? "—"}
                </div>
                <div className="mt-1">Confidence: {confidencePct}%</div>
              </div>

              <div className="practice-session__corrections p-3 rounded border bg-light">
                <div className="small text-uppercase text-muted mb-1">
                  Corrections
                </div>
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

              <div className="practice-session__timer text-center py-3 border rounded">
                <div className="small text-muted">Hold time remaining</div>
                <div className="display-6 fw-semibold">{remainingSec}s</div>
              </div>

              <button
                type="button"
                className="btn btn-outline-secondary mt-auto"
                onClick={handleStop}
              >
                Stop Practice
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PracticeSessionPage;
