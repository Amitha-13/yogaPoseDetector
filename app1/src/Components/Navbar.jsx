import React, { useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./Navbar.css";

const Navbar = () => {
  const { isAuthenticated, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <header className="research-nav">
      <div className="research-nav__inner">
        <button className="research-nav__toggle" onClick={() => setOpen(!open)} aria-label="Toggle navigation">☰</button>
        <nav className={`research-nav__links ${open ? "is-open" : ""}`}>
          <NavLink to="/" onClick={close}>Home</NavLink>
          <NavLink to="/about" onClick={close}>About</NavLink>
        </nav>
        <div className={`research-nav__actions ${open ? "is-open" : ""}`}>
          {isAuthenticated ? <><Link to="/app/dashboard" onClick={close}>Dashboard</Link><button onClick={() => { logout(); close(); }}>Logout</button></> : <Link to="/app/login" onClick={close}>Login <span>→</span></Link>}
        </div>
      </div>
    </header>
  );
};
export default Navbar;
