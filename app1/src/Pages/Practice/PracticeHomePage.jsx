import React from "react";
import { useNavigate } from "react-router-dom";
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

export const POSES = [
  { name: "Mountain Pose", sanskrit: "Tadasana", duration: 30, image: imgMountain },
  { name: "Tree Pose", sanskrit: "Vrikshasana", duration: 30, image: imgTree },
  { name: "Warrior I", sanskrit: "Virabhadrasana I", duration: 30, image: imgWarrior },
  {
    name: "Warrior II",
    sanskrit: "Virabhadrasana II",
    duration: 30,
    image: imgWarrior,
  },
  { name: "Triangle Pose", sanskrit: "Trikonasana", duration: 30, image: imgTriangle },
  {
    name: "Downward Dog",
    sanskrit: "Adho Mukha Svanasana",
    duration: 30,
    image: imgDownDog,
  },
  { name: "Chair Pose", sanskrit: "Utkatasana", duration: 30, image: imgChair },
  { name: "Cobra Pose", sanskrit: "Bhujangasana", duration: 30, image: imgCobra },
  { name: "Bridge Pose", sanskrit: "Setu Bandhasana", duration: 30, image: imgBridge },
  { name: "Child's Pose", sanskrit: "Balasana", duration: 30, image: imgChild },
];

const PracticeHomePage = () => {
  const navigate = useNavigate();

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
          <div key={pose.name} className="col-12 col-sm-6 col-lg-4">
            <div className="practice-home__card card h-100 shadow-sm">
              <div className="card-body d-flex flex-column">
                <h2 className="practice-home__pose-name card-title h5">
                  {pose.name}
                </h2>
                <div className="practice-home__img-wrap">
                  <img
                    src={pose.image}
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
