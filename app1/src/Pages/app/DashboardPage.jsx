import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import "./AppPages.css";

const API_BASE = "http://127.0.0.1:3001";

const DashboardPage = () => {
  const { token, currentUser } = useAuth();
  const [rows, setRows] = useState([]);
  const [historySessions, setHistorySessions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/practices/user/stats`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled && res.ok) setRows(data.rows || []);
      } catch {
        if (!cancelled) setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/practices/user/history`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!cancelled && res.ok) setHistorySessions(data.sessions || []);
      } catch {
        if (!cancelled) setHistorySessions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const totals = useMemo(() => {
    const totalPoses = rows.reduce((acc, r) => acc + Number(r.total_count || 0), 0);
    const totalSeconds = rows.reduce((acc, r) => acc + Number(r.total_seconds || 0), 0);
    return {
      totalPoses,
      totalMinutes: Math.round(totalSeconds / 60),
      totalSessions: historySessions.length,
      top3: [...rows].sort((a, b) => b.total_count - a.total_count).slice(0, 3),
      averageMinutes: historySessions.length ? Math.round(totalSeconds / 60 / historySessions.length) : 0,
      mostPracticed: [...rows].sort((a, b) => b.total_count - a.total_count)[0],
    };
  }, [rows, historySessions.length]);

  return (
    <div className="app-shell dashboard-shell">
      <div className="dashboard-head"><div><p className="eyebrow">PERSONAL PRACTICE SPACE</p><h1>Namaste, {currentUser?.full_name || "Yogi"} <span aria-label="namaste">🙏</span></h1><p>Your yoga practice at a glance.</p></div></div>
      <div className="stat-grid">
        <div className="stat-card"><span>◷</span><small>Total Sessions</small><b>{totals.totalSessions}</b></div>
        <div className="stat-card stat-card--green"><span>◌</span><small>Total Practice Time</small><b>{totals.totalMinutes}<em> min</em></b></div>
        <div className="stat-card"><span>◎</span><small>Total Poses Practiced</small><b>{totals.totalPoses}</b></div>
        <div className="stat-card stat-card--maroon"><span>◴</span><small>Average Session Duration</small><b>{totals.averageMinutes}<em> min</em></b></div>
      </div>
      <div className="dashboard-cta"><div><p className="eyebrow">READY WHEN YOU ARE</p><h2>Ready for your next session?</h2><p className="mb-0 mt-1 small">Continue your mindful movement with real-time pose assistance.</p></div><div><Link to="/app/hardware" className="btn app-btn-primary text-white">Start Practice →</Link><Link to="/app/history" className="btn btn-outline-dark ms-2">View History</Link></div></div>
      <div className="dashboard-lower">
        <div className="app-card dashboard-panel">
          <h2>Most Practiced Pose</h2>
          <div className="featured-pose"><span>◌</span><div><b>{totals.mostPracticed?.pose_name || "No pose recorded yet"}</b><p>{totals.mostPracticed ? `${totals.mostPracticed.total_count} completed practices` : "Start a session to build your profile."}</p></div></div>
        </div>
      </div>
      <div className="app-card dashboard-panel pose-list"><h2>Pose Activity</h2><div className="app-summary-grid">
        {totals.top3.map((pose) => (
          <div className="border rounded p-2 bg-white" key={pose.pose_name}>
            <div className="fw-semibold">{pose.pose_name}</div>
            <div className="small fst-italic text-muted">{pose.pose_sanskrit}</div>
            <div className="small mt-1">{pose.total_count} practices</div>
          </div>
        ))}
        {totals.top3.length === 0 ? <div className="text-muted small">No practice data yet.</div> : null}
      </div></div>
    </div>
  );
};

export default DashboardPage;
