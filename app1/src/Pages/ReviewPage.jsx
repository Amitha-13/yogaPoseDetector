import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";

import CONFIG from "../config";

import { useSession } from "../context/SessionContext";

import { saveSessionLocally } from "../utils/sessionExport";

import {

  COLLECTION_TYPES,

  getCollectionTypeAvailability,

  getConnectedSensorIds,

  getDefaultCollectionType,

  getBodyConnectionState,

  getFootrestConnectionState,

} from "../utils/collectionOptions";

import {

  normalizeImuPollPayload,

} from "../utils/sensorStatus";

import {

  getSessionsRootDisplay,

  stopOfflineSession,

  downloadSessionZip,

  uploadSessionToGdrive,

  fetchStorageVolumes,

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



  const [imuDevices, setImuDevices] = useState({});

  const [storageVolumes, setStorageVolumes] = useState(null);

  const [collectionType, setCollectionType] = useState(COLLECTION_TYPES.A.id);

  const [storageLocation, setStorageLocation] = useState("D");

  const [offlineFinalize, setOfflineFinalize] = useState(null);

  const [finalizingOffline, setFinalizingOffline] = useState(false);

  const [localSaveResults, setLocalSaveResults] = useState(null);

  const [localSaving, setLocalSaving] = useState(false);

  const [copied, setCopied] = useState(false);

  const [gdriveStatus, setGdriveStatus] = useState(null);

  const [gdriveUploading, setGdriveUploading] = useState(false);

  const [downloading, setDownloading] = useState(false);



  const dataUrl = CONFIG.FLASK_DATA_URL?.replace(/\/$/, "");



  useEffect(() => {

    if (!dataUrl) return undefined;

    let cancelled = false;

    const pollMs = Math.max(500, Number(CONFIG.IMU_POLL_MS) || 1000);



    const poll = async () => {

      try {

        const res = await fetch(`${dataUrl}/debug/imu`, { cache: "no-store" });

        if (cancelled || !res.ok) return;

        const data = await res.json();

        setImuDevices(normalizeImuPollPayload(data, CONFIG.SENSOR_SLOTS));

      } catch {

        if (!cancelled) setImuDevices({});

      }

    };



    void poll();

    const id = window.setInterval(poll, pollMs);

    return () => {

      cancelled = true;

      window.clearInterval(id);

    };

  }, [dataUrl]);



  useEffect(() => {

    let cancelled = false;

    (async () => {

      const volumes = await fetchStorageVolumes();

      if (!cancelled && volumes) {

        setStorageVolumes(volumes);

        if (volumes.default) {

          setStorageLocation(volumes.default);

        }

      }

    })();

    return () => {

      cancelled = true;

    };

  }, []);



  const collectionAvailability = useMemo(

    () => getCollectionTypeAvailability(imuDevices),

    [imuDevices]

  );



  useEffect(() => {

    const defaultType = getDefaultCollectionType(imuDevices);

    setCollectionType((prev) => {

      const availability = getCollectionTypeAvailability(imuDevices);

      const key =

        prev === COLLECTION_TYPES.A.id

          ? "A"

          : prev === COLLECTION_TYPES.B.id

            ? "B"

            : "C";

      if (availability[key]?.enabled) return prev;

      return defaultType;

    });

  }, [imuDevices]);



  const eDriveAvailable = useMemo(() => {

    const eVol = storageVolumes?.volumes?.find((v) => v.id === "E");

    if (eVol) return eVol.available === true;

    return false;

  }, [storageVolumes]);



  const bodyState = useMemo(() => getBodyConnectionState(imuDevices), [imuDevices]);

  const footrestState = useMemo(

    () => getFootrestConnectionState(imuDevices),

    [imuDevices]

  );



  const handleFinalizeSession = useCallback(async () => {

    setFinalizingOffline(true);

    setOfflineFinalize(null);

    try {

      const recorded = sessionRecordings.filter((r) => !r.skipped).length;

      const connectedIds = getConnectedSensorIds(imuDevices);

      const footrestIds = connectedIds.filter((id) =>

        CONFIG.SENSOR_SLOTS.some((s) => s.id === id && s.status === "placeholder")

      );

      const bodyIds = connectedIds.filter((id) =>

        CONFIG.SENSOR_SLOTS.some((s) => s.id === id && s.status === "active")

      );



      const result = await stopOfflineSession({

        participantId,

        participantName: metadata?.name || metadata?.username || username,

        posesRecorded: recorded,

        collectionType,

        storageLocation,

        connectedImus: bodyIds,

        connectedFootrestSensors: footrestIds,

      });



      if (result?.ok) {

        setOfflineFinalize(result);

        const dir =

          result.yoga_dataset_directory ||

          result.directory ||

          result.yoga_dataset?.directory;

        if (dir) {

          setOfflineSessionDirectory(dir);

        }

      } else {

        setOfflineFinalize({

          ok: false,

          error: result?.error || "Session finalize failed.",

        });

      }

    } catch (err) {

      setOfflineFinalize({

        ok: false,

        error: err?.message || String(err),

      });

    } finally {

      setFinalizingOffline(false);

    }

  }, [

    sessionRecordings,

    participantId,

    metadata,

    username,

    collectionType,

    storageLocation,

    imuDevices,

    setOfflineSessionDirectory,

  ]);



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



  const sessionDirectory =

    offlineFinalize?.directory ||

    offlineFinalize?.yoga_dataset_directory ||

    offlineSessionDirectory ||

    null;



  const sessionFinalized = Boolean(offlineFinalize?.ok);



  const handleDownloadZip = useCallback(async () => {

    if (!sessionDirectory) return;

    setDownloading(true);

    try {

      const blob = await downloadSessionZip(sessionDirectory);

      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");

      a.href = url;

      a.download = `${participantId}_session.zip`;

      a.click();

      URL.revokeObjectURL(url);

    } catch (err) {

      setGdriveStatus({ ok: false, message: err?.message || "Download failed." });

    } finally {

      setDownloading(false);

    }

  }, [sessionDirectory, participantId]);



  const handleGdriveUpload = useCallback(async () => {

    setGdriveUploading(true);

    setGdriveStatus(null);

    try {

      const result = await uploadSessionToGdrive(sessionDirectory);

      setGdriveStatus({

        ok: Boolean(result?.ok),

        message: result?.message || result?.error || "Upload complete.",

      });

    } catch (err) {

      setGdriveStatus({ ok: false, message: err?.message || "Upload failed." });

    } finally {

      setGdriveUploading(false);

    }

  }, [sessionDirectory]);



  const handleCopySummary = useCallback(() => {

    const payload = {

      participantId,

      metadata,

      collectionType,

      storageLocation,

      connectedImus: bodyState.connectedIds,

      connectedFootrestSensors: footrestState.connectedIds,

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

  }, [

    participantId,

    metadata,

    sessionRecordings,

    collectionType,

    storageLocation,

    bodyState,

    footrestState,

  ]);



  const handleStartNewSession = () => {
    bumpSessionNumber();
    window.location.href = "/login";
  };



  const recordedCount = sessionRecordings.filter((r) => !r.skipped).length;

  const skippedCount = sessionRecordings.filter((r) => r.skipped).length;



  const collectionOptions = [

    { key: "A", ...COLLECTION_TYPES.A },

    { key: "B", ...COLLECTION_TYPES.B },

    { key: "C", ...COLLECTION_TYPES.C },

  ];



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



      {!sessionFinalized && (

        <>

          <section className="review-section mb-4" aria-labelledby="collection-type-heading">

            <h2 id="collection-type-heading" className="h5 fw-bold mb-3">

              Collection Type

            </h2>

            <div className="collection-type-grid">

              {collectionOptions.map((opt) => {

                const avail = collectionAvailability[opt.key];

                const selected = collectionType === opt.id;

                return (

                  <label

                    key={opt.id}

                    className={`collection-type-card ${selected ? "collection-type-card--active" : ""} ${!avail.enabled ? "collection-type-card--disabled" : ""}`}

                  >

                    <input

                      type="radio"

                      name="collectionType"

                      value={opt.id}

                      checked={selected}

                      disabled={!avail.enabled || finalizingOffline}

                      onChange={() => setCollectionType(opt.id)}

                    />

                    <span className="collection-type-card__label">{opt.label}</span>

                    <span className="collection-type-card__desc">{opt.description}</span>

                    {!avail.enabled && avail.disabledReason && (

                      <span className="collection-type-card__reason">{avail.disabledReason}</span>

                    )}

                  </label>

                );

              })}

            </div>

            <p className="small text-muted mt-2 mb-0">

              Body sensors online: {bodyState.connectedIds.length} / {bodyState.requiredCount}

              {" · "}

              Footrest sensors online: {footrestState.connectedIds.length} /{" "}

              {footrestState.requiredCount}

            </p>

          </section>



          <section className="review-section storage-mode-selector mb-4" aria-labelledby="storage-location-heading">

            <h2 id="storage-location-heading" className="h5 fw-bold mb-3">

              Storage Location

            </h2>

            <div className="d-flex flex-wrap gap-3">

              <button

                type="button"

                className={`storage-btn ${storageLocation === "D" ? "storage-btn--active" : ""}`}

                disabled={finalizingOffline}

                onClick={() => setStorageLocation("D")}

              >

                D:\ Local Drive

                <span className="storage-btn__note">D:\YogaDataset</span>

              </button>

              <button

                type="button"

                className={`storage-btn ${storageLocation === "E" ? "storage-btn--active" : ""}`}

                disabled={!eDriveAvailable || finalizingOffline}

                onClick={() => setStorageLocation("E")}

              >

                E:\ External Hard Disk

                <span className="storage-btn__note">

                  {eDriveAvailable ? "E:\\YogaDataset" : "(Not Connected)"}

                </span>

              </button>

            </div>

          </section>



          {CONFIG.USE_OFFLINE_SESSION_RECORDER && (

            <div className="mb-4">

              <button

                type="button"

                className="btn btn-success btn-lg w-100"

                disabled={finalizingOffline}

                onClick={() => void handleFinalizeSession()}

              >

                {finalizingOffline

                  ? "Saving to YogaDataset…"

                  : "Save Session to YogaDataset"}

              </button>

              <p className="small text-muted mt-2 mb-0">

                Export root: <code>{getSessionsRootDisplay()}</code>

              </p>

            </div>

          )}

        </>

      )}



      {CONFIG.USE_OFFLINE_SESSION_RECORDER && sessionFinalized && (

        <div className="alert alert-success mb-4" role="status">

          <h2 className="h5 fw-bold mb-2">Session saved to YogaDataset</h2>

          <p className="mb-1">

            <strong>Collection type:</strong> <code>{collectionType}</code>

          </p>

          <p className="mb-1">

            <strong>Storage:</strong>{" "}

            <code>{storageLocation}:\YogaDataset</code>

          </p>

          <p className="mb-1">

            <strong>Folder:</strong>{" "}

            <code className="user-select-all">{sessionDirectory}</code>

          </p>

          <p className="mb-0 small">

            Contains <code>video.webm</code>, <code>imu_data.jsonl</code> (when applicable),{" "}

            <code>landmarks.json</code>, and <code>metadata.json</code> per pose folder.

          </p>

          <div className="d-flex flex-wrap gap-2 mt-3">

            <button

              type="button"

              className="btn btn-sm btn-success"

              disabled={downloading || !sessionDirectory}

              onClick={() => void handleDownloadZip()}

            >

              {downloading ? "Preparing…" : "Download Session ZIP"}

            </button>

            <button

              type="button"

              className="btn btn-sm btn-outline-dark"

              disabled={gdriveUploading || !sessionDirectory}

              onClick={() => void handleGdriveUpload()}

            >

              {gdriveUploading ? "Uploading…" : "Upload to Google Drive"}

            </button>

          </div>

          {gdriveStatus && (

            <p className={`small mt-2 mb-0 ${gdriveStatus.ok ? "text-success" : "text-danger"}`}>

              {gdriveStatus.message}

            </p>

          )}

        </div>

      )}



      {CONFIG.USE_OFFLINE_SESSION_RECORDER && offlineFinalize?.ok === false && (

        <div className="alert alert-danger mb-4" role="alert">

          Finalize error: {offlineFinalize.error}. Ensure{" "}

          <code>python backend/data_collection_server.py</code> is running, then try again.

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

            {localSaving ? "Saving…" : "Save Session to Device Folder"}

          </button>

          {localSaveResults?.success && (

            <div className="alert alert-success mt-3 mb-0">

              <strong>Saved locally.</strong> Folder:{" "}

              <code>{localSaveResults.folderName}</code>

            </div>

          )}

          {localSaveResults?.success === false && !localSaveResults?.cancelled && (

            <div className="alert alert-danger mt-3 mb-0">

              {localSaveResults.error}

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

