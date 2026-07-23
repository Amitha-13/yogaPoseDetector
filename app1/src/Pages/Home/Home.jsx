import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import annaUniversityLogo from "../../../../server/assets/1200px-Anna_University_Logo.svg.png";
import homepageBackground from "../../../assets/homepage_bg.png";
import commonYogaProtocolLogo from "../../../assets/Common_Yoga_Protocol.jpg";
import "./Home.css";

const API_BASE = "http://127.0.0.1:3001";

const Home = () => {
  const [disclaimer, setDisclaimer] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/api/config/homepage_disclaimer`)
      .then((response) => response.json())
      .then((data) => !cancelled && setDisclaimer(data.value || ""))
      .catch(() => !cancelled && setDisclaimer(""));
    return () => { cancelled = true; };
  }, []);

  return <main>
    <section className="research-hero" style={{ "--home-background": `url(${homepageBackground})` }}>
      <div className="research-hero__overlay" />
      <div className="research-hero__content">
        <div className="research-hero__heading-row">
          <img className="anna-university-logo" src={annaUniversityLogo} alt="Anna University" />
          <div className="research-hero__title-block">
            <p className="eyebrow">DIGITAL HEALTH · INTELLIGENT MOVEMENT</p>
            <h1>DIGITAL TWIN AND AI-POWERED YOGA ASSISTANT SYSTEM WITH REAL-TIME ASANA POSE ESTIMATION AND CORRECTIVE FEEDBACK</h1>
          </div>
          <div className="common-yoga-protocol-mark">
            <img className="common-yoga-protocol-logo" src={commonYogaProtocolLogo} alt="Common Yoga Protocol" />
            <span>Common Yoga Protocol</span>
          </div>
        </div>
        <div className="hero-rule" />
        <p className="research-hero__funding">Funded by CMRG</p>
        <p className="investigator"><b>Principal Investigator:</b> <span className="investigator__name">Dr. S. Chitrakala</span><span>Professor</span><span>Department of Computer Science and Engineering</span><span>College of Engineering Guindy</span><span>Anna University, Chennai</span></p>
        <div className="homeModuleCards">
          <Link to="/login" className="homeModuleCard homeModuleCard--data"><div className="module-icon">▦</div><div><b>Data Collection</b><p>For lab operators and researchers</p></div><strong>→</strong></Link>
          <Link to="/app" className="homeModuleCard homeModuleCard--practice"><div className="module-icon">◌</div><div><b>Yoga Practice</b><p>For individual users and learners</p></div><strong>→</strong></Link>
        </div>
        {disclaimer && <p className="homeDisclaimer"><span aria-hidden="true">ⓘ</span>{disclaimer}</p>}
      </div>
    </section>
  </main>;
};

export default Home;
