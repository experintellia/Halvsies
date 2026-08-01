// App entry point: mount <App/> into #app. No StrictMode-equivalent — a
// double-mount would double-register the self member.
//
// Self-registration deliberately does NOT happen here. It is a document write,
// and every write flushes to the chat, so registering at startup announced
// "X joined the split" before the app had even asked what currency this split
// uses. App.tsx does it once first-run setup is done.
import { render } from "preact";
import "./style/app.css";
import { App } from "./ui/App";

const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}
