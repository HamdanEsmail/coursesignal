import "@fontsource/literata/latin-500.css";
import "@fontsource/literata/latin-600.css";
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("Root element is missing.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
