import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import "./AppPages.css";

const API_BASE = "http://127.0.0.1:3001";

const LoginPage = () => {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      login(data.token, data.user);
      navigate("/app/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-auth-shell"><div className="auth-orb auth-orb--one"/><div className="auth-orb auth-orb--two"/><div className="auth-grid"/><form className="app-card auth-card app-form-wrap" onSubmit={handleSubmit}>
        <h1>Welcome back</h1><p className="auth-intro">Continue your mindful movement journey.</p>
        <div className="mb-3">
          <label className="form-label" htmlFor="login-email">Email</label>
          <input id="login-email" className="form-control" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="mb-3">
          <label className="form-label" htmlFor="login-password">Password</label>
          <input id="login-password" className="form-control" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error ? <div className="alert alert-danger py-2">{error}</div> : null}
        <button className="btn app-btn-primary text-white w-100" disabled={loading}>
          {loading ? "Signing in..." : "Login"}
        </button>
        <p className="small mt-3 mb-0">
          New here? <Link to="/app/signup">Create account</Link>
        </p>
      </form></div>
  );
};

export default LoginPage;
