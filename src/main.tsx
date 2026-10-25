import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/nunito";
import "./styles.css";
import { isMobile } from "./lib/api";

// The phone app draws under the status bar and gesture bar; this lets the CSS keep clear of them.
if (isMobile) document.documentElement.classList.add("mobile");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
