import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import BlueprintReport from "./BlueprintReport";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BlueprintReport />
  </StrictMode>,
);
