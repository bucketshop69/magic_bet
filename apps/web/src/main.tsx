import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import App from "./App";

// Anchor/web3 rely on Node-like globals in browser runtimes.
(window as any).Buffer = Buffer;
(window as any).global = window;
(window as any).process = (window as any).process ?? { env: {} };

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
