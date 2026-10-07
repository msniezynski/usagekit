import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import "@fontsource-variable/mona-sans/standard.css";
import "@fontsource-variable/geist-mono/wght.css";
import { App } from "./app.js";
import type { Page } from "./app.js";
import "./styles.css";

const pageOf = (path: string): Page =>
  path.startsWith("/docs")
    ? "docs"
    : path.startsWith("/components")
      ? "components"
      : path.startsWith("/agents")
        ? "agents"
        : "home";
const root = document.getElementById("root");
if (!root) throw new Error("Usagekit site root is missing");
const app = (
  <StrictMode>
    <App page={pageOf(window.location.pathname)} />
  </StrictMode>
);
if (root.hasChildNodes() && root.querySelector("header")) hydrateRoot(root, app);
else createRoot(root).render(app);
