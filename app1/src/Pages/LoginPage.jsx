import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import "./LoginPage.css";

const LoginPage = () => {
  const navigate = useNavigate();
  const { username, setUsername, greeting, setOperatorInfo } = useSession();
  const [operatorName, setOperatorName] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [usernameInput, setUsernameInput] = useState(username || "");

  const nowText = useMemo(() => new Date().toLocaleString(), []);
  const isValid =
    usernameInput.trim() !== "" &&
    operatorName.trim() !== "" &&
    institutionName.trim() !== "";

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!isValid) return;

    setUsername(usernameInput.trim());
    setOperatorInfo({
      operatorName: operatorName.trim(),
      institutionName: institutionName.trim(),
    });
    navigate("/metadata");
  };

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1 className="login-title">Yoga Posture Data Collection</h1>
        <p className="login-greeting">
          {greeting}
          {username ? `, ${username}` : ""}
        </p>
        <p className="login-datetime">{nowText}</p>

        <label className="field-label" htmlFor="username">
          Participant Username
        </label>
        <input
          id="username"
          className="field-input"
          type="text"
          value={usernameInput}
          onChange={(event) => setUsernameInput(event.target.value)}
          placeholder="e.g. meera"
          required
        />

        <label className="field-label" htmlFor="operatorName">
          Operator Name
        </label>
        <input
          id="operatorName"
          className="field-input"
          type="text"
          value={operatorName}
          onChange={(event) => setOperatorName(event.target.value)}
          required
        />

        <label className="field-label" htmlFor="institutionName">
          Institution / Lab Name
        </label>
        <input
          id="institutionName"
          className="field-input"
          type="text"
          value={institutionName}
          onChange={(event) => setInstitutionName(event.target.value)}
          required
        />

        <button type="submit" className="primary-btn" disabled={!isValid}>
          Continue
        </button>
      </form>
    </div>
  );
};

export default LoginPage;
