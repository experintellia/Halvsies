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

// iOS scrolls the window up to keep a focused input above the keyboard, and
// when that input unmounts while focused (Save closes the form) the keyboard
// drops without the scroll being undone: the page stays shifted up with a
// blank strip under the tab bar. Once the keyboard is gone, pull the scroll
// back inside the document. Clamped, not reset to 0, so a scrolled list
// keeps its place.
const vv = window.visualViewport;
vv?.addEventListener("resize", () => {
  if (vv.height < window.innerHeight) return; // keyboard still up
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (window.scrollY > max) window.scrollTo(0, Math.max(0, max));
});

const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}
