import "@fontsource/gloock/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { routeFromPath } from "./lib/route.js";
import { AddPage } from "./pages/AddPage.js";
import { SlipPage } from "./pages/SlipPage.js";
import "./styles.css";

const root = document.getElementById("root");

if (!root) throw new Error("Root element is missing.");

function Root() {
  const route = routeFromPath();
  if (route === "slip") return <SlipPage />;
  if (route === "add") return <AddPage />;
  return <App />;
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
