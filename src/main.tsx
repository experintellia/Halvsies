// App entry point: mount <App/> into #app. No StrictMode-equivalent — a
// double-mount would double-register the self member.
import { render } from "preact";
import "./style/app.css";
import { ensureSelfRegistered } from "./state/doc";
import { App } from "./ui/App";

try {
  ensureSelfRegistered();
} catch (err) {
  // No webxdc host (shouldn't happen inside a real messenger) — render
  // anyway rather than leaving a blank screen.
  console.error("ensureSelfRegistered failed:", err);
}

const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}
