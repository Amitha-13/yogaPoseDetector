import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CONFIG from "../config";
import { useSession } from "../context/SessionContext";
import { saveSessionLocally } from "../utils/sessionExport";
import {
  getSessionsRootDisplay,
  stopOfflineSession,
} from "../utils/sessionRecorderApi";
import "./ReviewPage.css";

function ReviewPage() {
  const navigate = useNavigate();
  const {
    sessionRecordings = [],
    metadata,
    participantId,
    greeting,
    username,
    bumpSessionNumber,
    offlineSessionDirectory,
    setOfflineSessionDirectory,
  } = useSession();

  const [offlineFinalize, setOfflineFinalize] = useState(null);
  const [finalizingOffline, setFinalizingOffline] = useState(false);
  const [localSaveResults, setLocalSaveResults] = useState(null);
  const [localSaving, setLocalSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const offlineFinalizedRef = useRef(false);

  useEffect(() => {
    if (!CONFIG.USE_OFFLINE_SESSION_RECORDER || offlineFinalizedRef.current) {
      return undefined;
    }
    offlineFinalizedRef.current = true;
    let cancelled = false;
    (async () => {
      setFinalizingOffline(true);
      try {
        const recorded = sessionRecordings.filter((r) => !r.skipped).length;
        const result = await stopOfflineSession({
          participantId,
          participantName: metadata?.username || metadata?.name,
          posesRecorded: recorded,
        });
        if (!cancelled && result?.ok) {
          setOfflineFinalize(result);
          if (result.directory) {
            setOfflineSessionDirectory(result.directory);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setOfflineFinalize({
            ok: false,
            error: err?.message || String(err),
          });
        }
      } finally {
        if (!cancelled) setFinalizingOffline(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [participantId, metadata, sessionRecordings, setOfflineSessionDirectory]);

  const handleLocalSave = useCallback(async () => {
    setLocalSaving(true);
    try {
      const result = await saveSessionLocally(sessionRecordings, metadata, participantId);
      setLocalSaveResults(result);
    } catch (err) {
      setLocalSaveResults({
        success: false,
        error: err?.message || String(err),
      });
    } finally {
      setLocalSaving(false);
    }
  }, [sessionRecordings, metadata, participantId]);

  const handleCopySummary = useCallback(() => {
    const payload = {
      participantId,
      metadata,
      sessionDate: new Date().toISOString(),
      sessionRecordings: sessionRecordings.map((r) => ({
        poseId: r.poseId,
        poseName: r.poseName,
        sanskrit: r.sanskrit,
        skipped: r.skipped,
        recordedAt: r.recordedAt,
        duration: r.duration,
        imuPacketCount: r.imuPackets?.length || 0,
        videoBytes: r.videoBlob?.size ?? 0,
      })),
    };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }, [participantId, metadata, sessionRecordings]);

  const handleStartNewSession = () => {
    if (
      !window.confirm(
        "Are you sure? All local session data will be cleared."
      )
    ) {
      return;
    }
    bumpSessionNumber();
    window.location.href = "/login";
  };

  const recordedCount = sessionRecordings.filter((r) => !r.skipped).length;
  const skippedCount = sessionRecordings.filter((r) => r.skipped).length;

  if (!sessionRecordings.length) {
    return (
      <div className="review-page">
        <div className="alert alert-warning">
          No session recordings found. Complete a session in the sequencer
          first.
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate("/sequencer")}
        >
          Go to Sequencer
        </button>
      </div>
    );
  }

  return (
    <div className="review-page">
      <header className="mb-4">
        <h1 className="h2 fw-bold">Session Review</h1>
        <p className="lead mb-1">
          {greeting}, {username || metadata?.name || "participant"}
        </p>
        <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
          <span className="badge bg-dark font-monospace">{participantId}</span>
          <span className="text-muted small">
            {new Date().toLocaleString()}
          </span>
        </div>
      </header>

      {CONFIG.USE_OFFLINE_SESSION_RECORDER && (
        <div className="alert alert-success mb-4" role="status">
          <h2 className="h5 fw-bold mb-2">Session saved locally</h2>
          {finalizingOffline ? (
            <p className="mb-0">Finalizing video, IMU JSON, and landmarks on disk…</p>
          ) : offlineFinalize?.ok === false ? (
            <p className="mb-0 text-danger">
              Finalize error: {offlineFinalize.error}. Ensure{" "}
              <code>python backend/data_collection_server.py</code> is running, then refresh.
            </p>
          ) : (
            <>
              <p className="mb-1">
                <strong>Folder:</strong>{" "}
                <code className="user-select-all">
                  {offlineFinalize?.directory ||
                    offlineSessionDirectory ||
                    getSessionsRootDisplay()}
                </code>
              </p>
              <p className="mb-0 small">
                Contains <code>video.webm</code>, <code>imu.json</code>,{" "}
                <code>landmarks.json</code>, and <code>metadata.json</code> in one folder.
                Optional cloud backup: run{" "}
                <code>python backend/upload_sessions_to_gdrive.py</code> manually when ready.
              </p>
            </>
          )}
        </div>
      )}

      {!CONFIG.USE_OFFLINE_SESSION_RECORDER && (
        <div className="mb-4">
          <button
            type="button"
            className="btn btn-success btn-lg w-100"
            onClick={() => void handleLocalSave()}
            disabled={localSaving}
          >
            {localSaving ? "Saving…" : "Export session ZIPs to folder"}
          </button>
          {localSaveResults?.success && (
            <div className="alert alert-success mt-3 mb-0">
              <strong>Saved locally.</strong> Folder:{" "}
              <code>{localSaveResults.folderName}</code>
            </div>
          )}
        </div>
      )}

      <div className="table-responsive bg-white rounded shadow-sm">
        <table className="table table-hover upload-table mb-0">
          <thead className="table-light">
            <tr>
              <th>Pose</th>
              <th>Frames</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sessionRecordings.map((r, i) => {
              const frameCount =
                typeof r.frameCount === "number"
                  ? r.frameCount
                  : r.landmarks?.length ?? 0;
              return (
                <tr key={`${r.poseId}-${i}`}>
                  <td>
                    <div className="fw-medium">{r.poseName}</div>
                    <div className="small text-muted fst-italic">{r.sanskrit}</div>
                  </td>
                  <td>
                    {r.skipped ? "—" : `${frameCount > 0 ? frameCount : 0} frames`}
                  </td>
                  <td>
                    {r.skipped ? (
                      <span className="text-secondary">Skipped</span>
                    ) : r.storedOffline ? (
                      <span className="text-success">Saved on disk</span>
                    ) : (
                      <span className="text-success">Recorded</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="summary-card mt-4">
        <h2 className="h5 fw-bold mb-3">Session summary</h2>
        <ul className="list-unstyled mb-0">
          <li>
            <strong>Poses recorded:</strong> {recordedCount}
          </li>
          <li>
            <strong>Poses skipped:</strong> {skippedCount}
          </li>
        </ul>
      </div>

      <div className="d-flex flex-wrap gap-2 mt-4">
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={handleCopySummary}
        >
          {copied ? "Copied! ✓" : "Copy Session Summary"}
        </button>
        <button
          type="button"
          className="btn btn-outline-danger ms-auto"
          onClick={handleStartNewSession}
        >
          Start New Session
        </button>
      </div>
    </div>
  );
}

export default ReviewPage;
