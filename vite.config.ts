import preact from "@preact/preset-vite";
import {
  buildXDC,
  eruda,
  mockWebxdc,
  secureContext,
} from "@webxdc/vite-plugins";
import { defineConfig } from "vite";

// webxdcViteConfig() hardcodes buildXDC()'s outFileName to "app.xdc" with no
// override hook, so the plugins are composed by hand here instead — same set
// webxdcViteConfig would push (buildXDC, eruda, mockWebxdc, secureContext),
// just with outFileName set to "halvsies.xdc".
export default defineConfig({
  plugins: [
    preact(),
    buildXDC({ outFileName: "halvsies.xdc" }),
    eruda(),
    mockWebxdc(),
    secureContext(),
  ],
  // safari14.1, not safari14: the layout uses flexbox `gap`, which WebKit only
  // shipped in 14.1. Rather than hand-rolling margin fallbacks across every
  // row for a population that effectively no longer exists (14.1 was a free
  // update in April 2021), the floor is declared honestly here. Note esbuild
  // does not polyfill CSS anyway — this string documents the target, the
  // stylesheet is what has to honour it.
  build: {
    target: ["es2020", "chrome87", "safari14.1", "firefox78"],
    // The modulepreload polyfill injects a `fetch()` call. It is dead code in
    // this single-chunk, no-dynamic-import build, but a webxdc bundle must
    // demonstrably make no network calls — dropping it keeps "the bundle
    // contains no fetch" a property you can grep for.
    modulePreload: { polyfill: false },
  },
});
