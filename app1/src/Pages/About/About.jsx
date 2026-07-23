import React from "react";
import "./About.css";

const capabilities = [
  "Real-time yoga pose tracking using computer vision",
  "MediaPipe-based body landmark detection",
  "Structured yoga practice sessions and camera-based posture capture",
  "IMU-based movement sensing when supported sensors are connected",
  "Synchronized capture of video, pose landmarks, and sensor information for research sessions",
  "Pose-wise practice, recording, and structured dataset generation",
  "A foundation for future AI-assisted posture evaluation and corrective feedback",
];

const About = () => (
  <main className="aboutPage">
    <section className="aboutHero">
      <p className="aboutEyebrow">ABOUT THE SYSTEM</p>
      <h1>Digital Twin and AI-Powered Yoga Assistant System</h1>
      <p> A research-oriented yoga posture analysis and practice platform for structured movement study, pose recording, and informed yoga practice.</p>
    </section>

    <div className="aboutContent">
      <section className="aboutCard aboutCard--wide">
        <h2>What the System Does</h2>
        <p>The system combines computer vision and wearable sensing to support structured yoga practice, posture capture, and movement analysis. It is designed to support the following capabilities:</p>
        <ul className="capabilityList">{capabilities.map((capability) => <li key={capability}>{capability}</li>)}</ul>
      </section>

      <section className="aboutModes">
        <article className="aboutCard modeCard modeCard--collection"><p className="cardLabel">MODE 01</p><h2>Data Collection</h2><p>Designed for researchers and lab operators. This workflow supports structured research sessions, participant and session information, synchronized recording, and the generation of organized research datasets.</p></article>
        <article className="aboutCard modeCard modeCard--practice"><p className="cardLabel">MODE 02</p><h2>Yoga Practice</h2><p>Designed for individual users and learners. Users can select yoga poses, prepare their hardware and camera, follow practice instructions, and perform recorded yoga practice sessions.</p></article>
      </section>

      <section className="aboutSplit">
        <article className="aboutCard"><h2>Technology</h2><div className="tagList"><span>MediaPipe pose tracking</span><span>Camera-based computer vision</span><span>IMU sensing</span><span>React-based user interface</span><span>Synchronized multimodal data collection</span></div></article>
        <article className="aboutCard"><h2>Research Purpose</h2><p>This project supports research into human pose estimation, yoga posture and movement analysis, multimodal sensor fusion, synchronized video and IMU data, and AI-assisted posture assessment.</p></article>
      </section>

      <aside className="aboutDisclaimer"><strong>Important disclaimer</strong><p>This system is intended to support guided yoga practice and research. It is not a substitute for professional medical advice, diagnosis, treatment, or qualified yoga instruction.</p></aside>
    </div>
  </main>
);

export default About;
