import React from "react";
import "./Home.css";
// import {Yoga_home}  from "../../assets/Yoga_home.png"
import { Link } from "react-router-dom";

const Home = () => {
  return (
    <div className="homeContainer d-flex p-3">
      <div className="homeInfo   d-flex flex-column p-4 my-auto gap-3  ">
        <div className="homeinfo_data d-flex flex-column  justify-content-center gap-3   ">
          <h1 className="homeInfo_heading">Yoga App </h1>
          <h4 className="homeInfo_subheading">
            Revitalize your mind, body, and soul
          </h4>
        </div>
        <div className="homeModuleCards d-flex flex-column flex-md-row gap-3 align-items-stretch">
          <Link
            to="/login"
            className="homeModuleCard homeModuleCard--data text-decoration-none flex-fill"
          >
            <span className="homeModuleCard__icon" aria-hidden>
              📊
            </span>
            <div className="homeModuleCard__body">
              <div className="homeModuleCard__title">Data Collection</div>
              <div className="homeModuleCard__subtitle">
                For lab operators and researchers
              </div>
            </div>
          </Link>
          <Link
            to="/practice"
            className="homeModuleCard homeModuleCard--practice text-decoration-none flex-fill"
          >
            <span className="homeModuleCard__icon" aria-hidden>
              🧘
            </span>
            <div className="homeModuleCard__body">
              <div className="homeModuleCard__title">Yoga Practice</div>
              <div className="homeModuleCard__subtitle">
                For individual users and learners
              </div>
            </div>
          </Link>
        </div>
      </div>
      {/* <div className="homeImg flex-grow-1  ">
        <img className="" src="./yoga_home.png" alt="" />
      </div> */}
    </div>
  );
};

export default Home;
