import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import CONFIG from "../config";
import { useSession } from "../context/SessionContext";
import { uploadSession } from "../utils/driveUpload";
import { addToQueue } from "../utils/uploadQueue";
import "./ReviewPage.css";

function ReviewPage() {
  const navigate = useNavigate();
  const {
    sessionRecordings = [],
    metadata,
    participantId,
    driveAccessToken,
    setDriveAccessToken,
  } = useSession();

  const [uploadProgress, setUploadProgress] = useState({});
  const [uploadComplete, setUploadComplete] = useState(false);
  const [sessionFolderLink, setSessionFolderLink] = useState(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [uploadResults, setUploadResults] = useState([]);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const uploadStartedRef = useRef(false);
  const folderInfoRef = useRef(null);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    const initial = {};
    sessionRecordings.forEach((r, i) => {
      initial[i] = {
        percent: r.skipped ? 100 : 0,
        status: r.skipped ? "skipped" : "pending",
        webViewLink: null,
      };
    });
    setUploadProgress(initial);
  }, [sessionRecordings]);

  useEffect(() => {
    if (!isOnline && sessionRecordings.length > 0) {
      sessionRecordings.forEach((r) => {
        if (!r.skipped) {
          addToQueue({
            sampleId: `${participantId}_${r.poseId}`,
            participantId,
            poseId: r.poseId,
          });
        }
      });
    }
  }, [isOnline, sessionRecordings, participantId]);

  const signInWithGoogle = useCallback(() => {
    if (!window.google?.accounts?.oauth2) {
      alert("Google Identity Services not loaded.");
      return;
    }
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: (response) => {
        if (response?.access_token) {
          setDriveAccessToken(response.access_token);
          setError(null);
        }
      },
    });
    tokenClient.requestAccessToken();
  }, [setDriveAccessToken]);

  const runUpload = useCallback(
    async (options = {}) => {
      setError(null);
      try {
        const result = await uploadSession(
          sessionRecordings,
          metadata,
          participantId,
          driveAccessToken,
          (poseIndex, percent, status) => {
            setUploadProgress((prev) => ({
              ...prev,
              [poseIndex]: {
                ...prev[poseIndex],
                percent,
                status,
              },
            }));
          },
          options
        );

        folderInfoRef.current = {
          participantFolderId: result.participantFolderId,
          sessionFolderId: result.sessionFolderId,
        };

        result.results.forEach((r) => {
          const st = r.status;
          setUploadProgress((prev) => ({
            ...prev,
            [r.index]: {
              ...prev[r.index],
              percent: st === "failed" ? 0 : 100,
              status: st,
              webViewLink: r.webViewLink || prev[r.index]?.webViewLink,
              driveFileId: r.driveFileId || prev[r.index]?.driveFileId,
            },
          }));
        });

        setSessionFolderLink(result.sessionFolderLink);
        setUploadResults(result.results);
        setUploadComplete(true);
      } catch (err) {
        if (err?.status === 401) {
          setError("Google token expired. Please re-authenticate.");
        } else {
          setError(`Upload failed: ${err?.message || String(err)}`);
        }
        throw err;
      }
    },
    [
      sessionRecordings,
      metadata,
      participantId,
      driveAccessToken,
    ]
  );

  useEffect(() => {
    if (!isOnline || !driveAccessToken || sessionRecordings.length === 0) {
      return;
    }
    const t = window.setTimeout(() => {
      if (!uploadStartedRef.current) {
        uploadStartedRef.current = true;
        runUpload().catch(() => {
          uploadStartedRef.current = false;
        });
      }
    }, 1000);
    return () => window.clearTimeout(t);
  }, [isOnline, driveAccessToken, sessionRecordings.length, runUpload]);

  const failedIndices = useMemo(() => {
    const fromResults = uploadResults
      .filter((r) => r.status === "failed")
      .map((r) => r.index);
    if (fromResults.length > 0) return fromResults;
    return Object.entries(uploadProgress)
      .filter(([, v]) => v.status === "failed")
      .map(([k]) => Number(k));
  }, [uploadResults, uploadProgress]);

  const handleRetryFailed = useCallback(() => {
    const resume = folderInfoRef.current;
    const opts =
      resume && failedIndices.length > 0
        ? { resume, onlyIndices: failedIndices }
        : {};
    uploadStartedRef.current = true;
    runUpload(opts).catch(() => {
      uploadStartedRef.current = false;
    });
  }, [runUpload, failedIndices]);

  const handleRetryOne = useCallback(
    (index) => {
      const resume = folderInfoRef.current;
      const opts =
        resume ? { resume, onlyIndices: [index] } : {};
      uploadStartedRef.current = true;
      runUpload(opts).catch(() => {
        uploadStartedRef.current = false;
      });
    },
    [runUpload]
  );

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
    window.location.href = "/login";
  };

  const recordedCount = sessionRecordings.filter((r) => !r.skipped).length;
  const skippedCount = sessionRecordings.filter((r) => r.skipped).length;
  const datasetFolderUrl = `https://drive.google.com/drive/folders/${CONFIG.YOGA_DATASET_FOLDER_ID}`;

  const driveCell = (i) => {
    const p = uploadProgress[i] || {};
    const st = p.status || "pending";
    if (st === "pending") {
      return <span className="text-secondary">Waiting</span>;
    }
    if (st === "uploading") {
      return (
        <div className="progress-cell">
          <div className="progress" style={{ height: "8px" }}>
            <div
              className="progress-bar progress-bar-striped progress-bar-animated"
              style={{ width: `${p.percent || 0}%` }}
            />
          </div>
          <small className="text-muted">{p.percent || 0}%</small>
        </div>
      );
    }
    if (st === "uploaded") {
      return <span className="text-success fw-semibold">✓ Uploaded</span>;
    }
    if (st === "already_uploaded") {
      return <span className="text-info fw-semibold">Already uploaded</span>;
    }
    if (st === "skipped") {
      return <span className="text-secondary">Skipped</span>;
    }
    if (st === "failed") {
      return <span className="text-danger fw-semibold">Failed</span>;
    }
    return <span className="text-secondary">—</span>;
  };

  const statusCell = (i) => {
    const st = uploadProgress[i]?.status || "pending";
    const map = {
      pending: { text: "⏳ Queued", cls: "text-secondary" },
      uploading: { text: "⬆ Uploading", cls: "text-primary" },
      uploaded: { text: "✅ Complete", cls: "text-success" },
      already_uploaded: { text: "✅ Complete", cls: "text-success" },
      skipped: { text: "⏭ Skipped", cls: "text-secondary" },
      failed: { text: "❌ Failed", cls: "text-danger" },
    };
    const m = map[st] || map.pending;
    return <span className={m.cls}>{m.text}</span>;
  };

  const actionCell = (r, i) => {
    const st = uploadProgress[i]?.status;
    if (st === "failed") {
      return (
        <button
          type="button"
          className="btn btn-sm btn-outline-warning"
          onClick={() => handleRetryOne(i)}
        >
          Retry
        </button>
      );
    }
    if (st === "uploaded" && uploadProgress[i]?.webViewLink) {
      return (
        <a
          href={uploadProgress[i].webViewLink}
          target="_blank"
          rel="noopener noreferrer"
          className="drive-link small"
        >
          Open in Drive
        </a>
      );
    }
    if (st === "uploaded" && uploadProgress[i]?.driveFileId) {
      const url = `https://drive.google.com/file/d/${uploadProgress[i].driveFileId}/view`;
      return (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="drive-link small"
        >
          Open in Drive
        </a>
      );
    }
    return null;
  };

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
        <h1 className="h2 fw-bold">Session Review &amp; Upload</h1>
        <div className="d-flex flex-wrap align-items-center gap-2 mt-2">
          <span className="badge bg-dark font-monospace">{participantId}</span>
          <span className="text-muted small">
            {new Date().toLocaleString()}
          </span>
        </div>
      </header>

      {!isOnline && (
        <div className="alert alert-warning" role="alert">
          ⚠ No internet connection. Uploads will start automatically when
          connected.
        </div>
      )}

      {error && (
        <div className="alert alert-danger d-flex flex-wrap align-items-center gap-2 justify-content-between">
          <span>{error}</span>
          <button
            type="button"
            className="btn btn-sm btn-outline-light"
            onClick={signInWithGoogle}
          >
            Re-authenticate with Google
          </button>
        </div>
      )}

      {!driveAccessToken && (
        <div className="alert alert-info">
          <p className="mb-2">Google Drive access is required to upload.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={signInWithGoogle}
          >
            Sign in with Google (Drive Access)
          </button>
        </div>
      )}

      <div className="table-responsive bg-white rounded shadow-sm">
        <table className="table table-hover upload-table mb-0">
          <thead className="table-light">
            <tr>
              <th>Pose</th>
              <th>Local</th>
              <th>Frames</th>
              <th>Drive Upload</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {sessionRecordings.map((r, i) => (
              <tr key={`${r.poseId}-${i}`}>
                <td>
                  <div className="fw-medium">{r.poseName}</div>
                  <div className="small text-muted fst-italic">{r.sanskrit}</div>
                </td>
                <td>
                  <span className="text-success">✓ Saved</span>
                </td>
                <td>
                  {r.skipped
                    ? "—"
                    : `${(() => {
                        const fc =
                          typeof r.frameCount === "number"
                            ? r.frameCount
                            : r.landmarks?.length ?? 0;
                        return fc > 0 ? fc : 0;
                      })()} frames`}
                </td>
                <td>{driveCell(i)}</td>
                <td>{statusCell(i)}</td>
                <td>{actionCell(r, i)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {uploadComplete && (
        <div className="summary-card">
          <h2 className="h4 fw-bold mb-3">
            🎉 Session upload finished
            {failedIndices.length === 0
              ? " — all files uploaded!"
              : ` — ${failedIndices.length} file(s) need attention`}
          </h2>
          <ul className="list-unstyled mb-3">
            <li>
              <strong>Participant ID:</strong>{" "}
              <span className="font-monospace">{participantId}</span>
            </li>
            <li>
              <strong>Date:</strong> {new Date().toLocaleString()}
            </li>
            <li>
              <strong>Poses recorded:</strong> {recordedCount}
            </li>
            <li>
              <strong>Poses skipped:</strong> {skippedCount}
            </li>
            <li>
              <strong>Drive folder:</strong>{" "}
              {sessionFolderLink ? (
                <a
                  href={sessionFolderLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="drive-link"
                >
                  Open session folder
                </a>
              ) : (
                "—"
              )}
            </li>
            <li className="mt-2">
              <a
                href={datasetFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="drive-link"
              >
                Open YogaDataset folder
              </a>
            </li>
          </ul>
        </div>
      )}

      <div className="d-flex flex-wrap gap-2 mt-4">
        {failedIndices.length > 0 && (
          <button
            type="button"
            className="btn btn-warning"
            onClick={handleRetryFailed}
            disabled={!driveAccessToken}
          >
            Retry Failed
          </button>
        )}
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={handleCopySummary}
        >
          {copied ? "Copied! ✓" : "Copy Session Summary"}
        </button>
        {driveAccessToken && isOnline && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              uploadStartedRef.current = true;
              runUpload().catch(() => {
                uploadStartedRef.current = false;
              });
            }}
          >
            Run upload again
          </button>
        )}
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
