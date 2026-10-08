import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
// Bundled (not Google Fonts) so the type still works offline in the mountains; Hebrew + Latin only.
import "@fontsource/assistant/hebrew-400.css";
import "@fontsource/assistant/hebrew-600.css";
import "@fontsource/assistant/hebrew-700.css";
import "@fontsource/assistant/latin-400.css";
import "@fontsource/assistant/latin-600.css";
import "@fontsource/assistant/latin-700.css";
import "@fontsource/secular-one/hebrew-400.css";
import "@fontsource/secular-one/latin-400.css";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import { App } from "./App";

registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
