import preact from "@preact/preset-vite";
import { buildXDC, eruda, mockWebxdc } from "@webxdc/vite-plugins";
import { defineConfig } from "vite";

// webxdcViteConfig() hardcodes buildXDC()'s outFileName to "app.xdc" with no
// override hook, so the plugins are composed by hand here instead.
//
// secureContext() is deliberately NOT included, unlike webxdcViteConfig()'s
// default set. It serves the dev server over HTTPS with a self-signed cert,
// which breaks `pnpm test:peers` in both directions: webxdc-dev cannot reach
// http://localhost:3000 (nothing listens), and against https://localhost:3000
// it dies with DEPTH_ZERO_SELF_SIGNED_CERT. Since browsers already treat
// http://localhost as a secure context, dropping it costs nothing locally —
// secure-context APIs (clipboard, crypto.subtle) still work — and it makes the
// multi-peer loop that Plan.md M1 is accepted against actually runnable. The
// trade-off is loading the dev server from another device over the LAN, which
// is not a secure context over plain HTTP; test on-device with the built .xdc
// in a real messenger instead, which is the truthful test anyway.
export default defineConfig({
  plugins: [
    preact(),
    buildXDC({ outFileName: "halvsies.xdc" }),
    eruda(),
    mockWebxdc(),
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
