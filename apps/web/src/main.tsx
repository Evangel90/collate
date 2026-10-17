import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./styles.css"

// StrictMode mounts every effect twice in development; collate-core shares identical reads in
// flight, so that costs no extra Arkiv queries.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
