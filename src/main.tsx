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

// iOS scrolls the window to keep a focused input above the keyboard, and
// when that input unmounts while focused (Save closes the form) the keyboard
// drops without the scroll being undone: the page stays shifted up with a
// blank strip under the tab bar. The page itself never scrolls (only
// .app-content and sub-pages do), so once the keyboard is gone any window
// scroll is that leftover — put it back.
const vv = window.visualViewport;
vv?.addEventListener("resize", () => {
  if (vv.height < window.innerHeight) return; // keyboard still up
  if (window.scrollY !== 0 || vv.offsetTop !== 0) window.scrollTo(0, 0);
});

// Only a box that can actually scroll may take a drag. Everything else — the
// header, the tab bar, a list too short to scroll, a sheet's backdrop —
// would hand the drag to the page itself, and iOS WebViews keep the
// keyboard's height as scroll room on the page after it closes: dragging
// there slid the whole app, tab bar and all. CSS can't remove that room (it
// lives in the native scroll view), so refuse the drag instead. Pinch-zoom,
// and panning around a zoomed-in page, stay untouched.
document.addEventListener(
  "touchmove",
  (e) => {
    if (e.touches.length > 1 || (vv && vv.scale > 1)) return;
    const box = (e.target as Element).closest(
      ".app-content, .sheet, .sheet-backdrop",
    );
    if (!box || box.scrollHeight <= box.clientHeight) e.preventDefault();
  },
  { passive: false },
);

const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}
