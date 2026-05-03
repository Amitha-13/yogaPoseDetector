import React from "react";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import Navbar from "./Components/Navbar";
import Home from "./Pages/Home/Home";
import About from "./Pages/About/About";
import Whats from "./Pages/Whats/Whats";
import Yog1 from "./Pages/YogaPages/Yog1";
import Yog2 from "./Pages/YogaPages/Yog2";
import Yog3 from "./Pages/YogaPages/Yog3";
import Yog4 from "./Pages/YogaPages/Yog4";
import Yog5 from "./Pages/YogaPages/Yog5";
import Yog6 from "./Pages/YogaPages/Yog6";
import LoginPage from "./Pages/LoginPage";
import MetadataPage from "./Pages/MetadataPage";
import ConsentPage from "./Pages/ConsentPage";
import HardwarePage from "./Pages/HardwarePage";
import SequencerPage from "./Pages/SequencerPage";
import ReviewPage from "./Pages/ReviewPage";
import PracticeHomePage from "./Pages/Practice/PracticeHomePage";
import PracticeSessionPage from "./Pages/Practice/PracticeSessionPage";
import { SessionContextProvider } from "./context/SessionContext";
import { PracticeContextProvider } from "./context/PracticeContext";
import RequireSession from "./Components/RequireSession";

const App = () => {
  return (
    <div className="app">
      <SessionContextProvider>
        <PracticeContextProvider>
          <BrowserRouter>
            <Navbar />
            <Routes>
              <Route path="/">
                <Route index element={<Home />} />
                <Route path="about" element={<About />} />
                <Route path="whats" element={<Whats />} />
                <Route path="learn">
                  <Route index element={<Navigate to="/login" replace />} />
                  <Route path="yog1" element={<Yog1 />} />
                  <Route path="yog2" element={<Yog2 />} />
                  <Route path="yog3" element={<Yog3 />} />
                  <Route path="yog4" element={<Yog4 />} />
                  <Route path="yog5" element={<Yog5 />} />
                  <Route path="yog6" element={<Yog6 />} />
                </Route>
              </Route>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/practice" element={<PracticeHomePage />} />
              <Route path="/practice/session" element={<PracticeSessionPage />} />
              <Route
                path="/metadata"
                element={
                  <RequireSession step="metadata">
                    <MetadataPage />
                  </RequireSession>
                }
              />
              <Route
                path="/consent"
                element={
                  <RequireSession step="consent">
                    <ConsentPage />
                  </RequireSession>
                }
              />
              <Route path="/hardware" element={<HardwarePage />} />
              <Route path="/sequencer" element={<SequencerPage />} />
              <Route path="/review" element={<ReviewPage />} />
            </Routes>
          </BrowserRouter>
        </PracticeContextProvider>
      </SessionContextProvider>
    </div>
  );
};

export default App;
