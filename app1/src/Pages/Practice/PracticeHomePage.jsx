import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { POSES } from "../../data/poses";
import { usePractice } from "../../context/PracticeContext";
import "./PracticeHomePage.css";
import imgMountain from "../../assets/yoga13.jpg";
import imgTree from "../../assets/yoga20.jpg";
import imgWarrior from "../../assets/yoga12.jpg";
import imgTriangle from "../../assets/yoga25.jpg";
import imgDownDog from "../../assets/yoga9.jpg";
import imgChair from "../../assets/yoga19.jpg";
import imgCobra from "../../assets/yoga15.jpg";
import imgBridge from "../../assets/yoga232.png";
import imgChild from "../../assets/yoga9.jpg";

const poseImageMap = {
  "Mountain Pose": imgMountain,
  "Tree Pose": imgTree,
  "Hand-to-Foot Pose": imgDownDog,
  "Half Wheel Pose": imgWarrior,
  "Half Waist Wheel Pose": imgWarrior,
  "Triangle Pose": imgTriangle,
  "Revolved Triangle Pose": imgTriangle,
  "Half Camel Pose": imgBridge,
  "Twisted Pose": imgChair,
  "Crocodile Pose": imgChild,
  "Cobra Pose": imgCobra,
  "Half Plough Pose": imgChair,
  "Corpse Pose": imgChild,
};

const PracticeHomePage = () => {
  const navigate = useNavigate();
  const { consentGiven } = usePractice();

  useEffect(() => {
    if (!consentGiven) {
      navigate("/practice/consent", { replace: true });
    }
  }, [consentGiven, navigate]);

  return (
    <div className="practice-home">
      <header className="practice-home__header text-center mb-4">
        <h1 className="practice-home__title">Yoga Practice</h1>
        <p className="practice-home__subtitle text-muted">
          Get real-time posture feedback
        </p>
      </header>

      <div className="row g-4">
        {POSES.map((pose) => (
          <div key={pose.id} className="col-12 col-sm-6 col-lg-4">
            <div className="practice-home__card card h-100 shadow-sm">
              <div className="card-body d-flex flex-column">
                <h2 className="practice-home__pose-name card-title h5">
                  {pose.name}
                </h2>
                <div className="practice-home__img-wrap">
                  <img
                    src={poseImageMap[pose.name] || imgMountain}
                    alt={`${pose.name} (${pose.sanskrit}) reference`}
                    className="practice-home__pose-img"
                    loading="lazy"
                  />
                </div>
                <p className="practice-home__sanskrit fst-italic text-muted small mb-2">
                  {pose.sanskrit}
                </p>
                <span className="practice-home__badge badge bg-secondary align-self-start mb-3">
                  {pose.duration} sec
                </span>
                <button
                  type="button"
                  className="btn mt-auto practice-home__start-btn"
                  onClick={() =>
                    navigate("/practice/session", { state: { pose } })
                  }
                >
                  Start Practice
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PracticeHomePage;
