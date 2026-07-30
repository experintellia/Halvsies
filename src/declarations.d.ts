/// <reference types="vite/client" />
// Pull in the `Window.webxdc` global augmentation — @webxdc/types' main entry
// only exports the interface, the global lives in a side file nothing imports.
/// <reference types="@webxdc/types/global" />

// NOTE: y-webxdc deliberately has no local declaration here. Up to 1.2.0 it
// shipped untyped with `WebxdcProvider` as a *default* export (its README said
// named — that was wrong). Since 1.3.0 it ships its own dist/index.d.ts and
// exports the class as a *named* export. A hand-written `declare module
// "y-webxdc"` would shadow those real types and reintroduce that mismatch
// silently: tsc would pass against the fiction while the bundler failed on the
// fact, which is exactly how it was caught here.
