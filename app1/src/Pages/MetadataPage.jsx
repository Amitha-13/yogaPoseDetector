import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSession } from "../context/SessionContext";
import "./MetadataPage.css";

const requiredFields = ["name", "age", "gender", "height", "weight", "experience"];

const validateField = (name, value) => {
  const stringValue = String(value ?? "").trim();

  if (name === "name" && !stringValue) return "Participant name is required.";

  if (name === "age") {
    const age = Number(stringValue);
    if (!stringValue) return "Age is required.";
    if (Number.isNaN(age) || age < 10 || age > 90) return "Age must be between 10 and 90.";
    return "";
  }

  if (name === "gender" && !stringValue) return "Gender is required.";
  if (name === "experience" && !stringValue) return "Yoga experience is required.";

  if (name === "height") {
    const height = Number(stringValue);
    if (!stringValue) return "Height is required.";
    if (Number.isNaN(height) || height <= 0) return "Height must be greater than 0.";
  }

  if (name === "weight") {
    const weight = Number(stringValue);
    if (!stringValue) return "Weight is required.";
    if (Number.isNaN(weight) || weight <= 0) return "Weight must be greater than 0.";
  }

  return "";
};

const MetadataPage = () => {
  const navigate = useNavigate();
  const { operatorInfo, participantId, metadata, setMetadata, username, greeting, sessionNumber } =
    useSession();
  const [formData, setFormData] = useState(metadata);
  const [touched, setTouched] = useState({});

  const errors = useMemo(() => {
    const next = {};
    requiredFields.forEach((key) => {
      next[key] = validateField(key, formData[key]);
    });
    return next;
  }, [formData]);

  const isValid = requiredFields.every((key) => errors[key] === "");

  const updateField = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const onBlur = (name) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(participantId);
    } catch (_) {
      // Ignore clipboard errors in unsupported contexts.
    }
  };

  const onSubmit = (event) => {
    event.preventDefault();
    if (!isValid) {
      const markAll = {};
      requiredFields.forEach((field) => {
        markAll[field] = true;
      });
      setTouched(markAll);
      return;
    }

    setMetadata({
      ...formData,
      username,
      sessionNumber,
      sessionDate: formData.sessionDate || new Date().toLocaleString(),
    });
    navigate("/consent");
  };

  return (
    <div className="metadata-page">
      <form className="metadata-card" onSubmit={onSubmit}>
        <div className="meta-top">
          <div>
            {greeting}, {username || "participant"}
          </div>
          <div>
            Operator: {operatorInfo.operatorName} - {operatorInfo.institutionName}
          </div>
          <div className="participant-badge">
            Participant ID: {participantId}
            <button type="button" className="copy-btn" onClick={copyId}>
              Copy
            </button>
          </div>
          <div>Session Date: {formData.sessionDate}</div>
        </div>

        <div className="meta-grid">
          <div>
            <label className="meta-label" htmlFor="age">
              Age
            </label>
            <input
              id="age"
              className="meta-input"
              type="number"
              required
              min="10"
              max="90"
              value={formData.age}
              onChange={(event) => updateField("age", event.target.value)}
              onBlur={() => onBlur("age")}
            />
            {touched.age && errors.age && <p className="field-error">{errors.age}</p>}
          </div>

          <div>
            <label className="meta-label" htmlFor="gender">
              Gender
            </label>
            <select
              id="gender"
              className="meta-select"
              required
              value={formData.gender}
              onChange={(event) => updateField("gender", event.target.value)}
              onBlur={() => onBlur("gender")}
            >
              <option value="">Select</option>
              <option value="Male">Male</option>
              <option value="Female">Female</option>
              <option value="Other">Other</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>
            {touched.gender && errors.gender && <p className="field-error">{errors.gender}</p>}
          </div>

          <div>
            <label className="meta-label" htmlFor="height">
              Height in cm
            </label>
            <input
              id="height"
              className="meta-input"
              type="number"
              required
              value={formData.height}
              onChange={(event) => updateField("height", event.target.value)}
              onBlur={() => onBlur("height")}
            />
            {touched.height && errors.height && <p className="field-error">{errors.height}</p>}
          </div>

          <div>
            <label className="meta-label" htmlFor="weight">
              Weight in kg
            </label>
            <input
              id="weight"
              className="meta-input"
              type="number"
              required
              value={formData.weight}
              onChange={(event) => updateField("weight", event.target.value)}
              onBlur={() => onBlur("weight")}
            />
            {touched.weight && errors.weight && <p className="field-error">{errors.weight}</p>}
          </div>

          <div className="meta-field-full">
            <label className="meta-label" htmlFor="experience">
              Yoga Experience
            </label>
            <select
              id="experience"
              className="meta-select"
              required
              value={formData.experience}
              onChange={(event) => updateField("experience", event.target.value)}
              onBlur={() => onBlur("experience")}
            >
              <option value="">Select</option>
              <option value="Beginner">Beginner</option>
              <option value="Intermediate">Intermediate</option>
              <option value="Advanced">Advanced</option>
            </select>
            {touched.experience && errors.experience && (
              <p className="field-error">{errors.experience}</p>
            )}
          </div>

          <div className="meta-field-full">
            <label className="meta-label" htmlFor="name">
              Participant Name
            </label>
            <input
              id="name"
              className="meta-input"
              type="text"
              required
              placeholder="Enter participant name"
              value={formData.name}
              onChange={(event) => updateField("name", event.target.value)}
              onBlur={() => onBlur("name")}
            />
            {touched.name && errors.name && <p className="field-error">{errors.name}</p>}
          </div>

          <div className="meta-field-full">
            <label className="meta-label" htmlFor="healthRemarks">
              Health Remarks <span className="optional-tag">Optional</span>
            </label>
            <textarea
              id="healthRemarks"
              className="meta-textarea"
              rows={3}
              placeholder="Injuries, conditions or movement limitations"
              value={formData.healthRemarks}
              onChange={(event) => updateField("healthRemarks", event.target.value)}
            />
          </div>
        </div>

        <button className="meta-submit" type="submit" disabled={!isValid}>
          Next: Consent Form
        </button>
      </form>
    </div>
  );
};

export default MetadataPage;
