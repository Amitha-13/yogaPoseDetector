import React, { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import CONFIG from "../config";
import "./SensorStatusStrip.css";

function SensorStatusStrip() {
  const location = useLocation();
  const { hardwareCalibrationConfirmed } = useSession();
  const [imuDevices, setImuDevices] = useState({});
  const [bridgeReachable, setBridgeReachable] = useState(false);

  const dataUrl = CONFIG.FLASK_DATA_URL?.replace(/\/$/, "");

  useEffect(() => {
    if (!hardwareCalibrationConfirmed || !dataUrl) {
      setImuDevices({});
      setBridgeReachable(false);
      return undefined;
    }

    let cancelled = false;
    const statusUrl = `${dataUrl}/debug/imu`;
    const pollMs = Math.max(500, Number(CONFIG.IMU_POLL_MS) || 1000);

    const poll = async () => {
      try {
        const res = await fetch(statusUrl, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setBridgeReachable(false);
          setImuDevices({});
          return;
        }
        const data = await res.json();
        setBridgeReachable(true);
        const normalized = {};
        if (data && typeof data === "object") {
          Object.keys(data).forEach((deviceId) => {
            const device = data[deviceId];
            if (device && typeof device === "object") {
              normalized[deviceId] = { online: device.online === true };
            }
          });
        }
        setImuDevices(normalized);
      } catch {
        if (!cancelled) {
          setBridgeReachable(false);
          setImuDevices({});
        }
      }
    };

    void poll();
    const id = window.setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [dataUrl, hardwareCalibrationConfirmed]);

  const shouldShow = useMemo(() => {
    if (!hardwareCalibrationConfirmed) return false;
    const hiddenRoutes = new Set(["/login", "/metadata", "/consent"]);
    return !hiddenRoutes.has(location.pathname);
  }, [hardwareCalibrationConfirmed, location.pathname]);

  if (!shouldShow) return null;

  return (
    <div className="sensor-strip" role="status" aria-live="polite">
      <div className="sensor-strip__bridge">
        IMU Bridge:{" "}
        <span className={bridgeReachable ? "is-live" : "is-down"}>
          {bridgeReachable ? "Live" : "Down"}
        </span>
      </div>
      <div className="sensor-strip__capsules">
        {CONFIG.SENSOR_SLOTS.map((slot) => {
          const isLive = imuDevices[slot.id]?.online === true;
          const variant = isLive
            ? "live"
            : slot.status === "placeholder"
              ? "reserved"
              : "missing";
          return (
            <span
              key={slot.id}
              className={`sensor-capsule sensor-capsule--${variant}`}
              title={`${slot.label} • ${slot.bodyPart} • ${
                isLive ? "Live" : slot.status === "placeholder" ? "Reserved" : "Missing"
              }`}
            >
              {slot.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default SensorStatusStrip;
