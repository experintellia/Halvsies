// Make Preact's useEffect actually run in tests.
//
// Preact defers passive effects to "after paint": it races
// requestAnimationFrame against a 100 ms setTimeout. happy-dom ships no rAF,
// so every effect in this suite used to sit on the 100 ms fallback while the
// tests' `await new Promise(r => setTimeout(r, 0))` helpers resolved on the
// next macrotask and asserted against a tree whose effects had never fired.
//
// Nothing failed, which is what made it hard to see: the tests that mattered
// asserted first-render output or local state, so they passed either way. But
// it meant nothing subscribed to the doc (useDocValue's subscription is an
// effect), so no test ever saw a component re-render in response to a remote
// update — the entire point of a CRDT app — and useSelfId never registered
// anyone.
//
// A same-tick rAF shim is enough: Preact only needs a callback source, and a
// macrotask keeps the existing `flush()`/`tick()` helpers correct.
if (typeof globalThis.requestAnimationFrame !== "function") {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number =>
    setTimeout(
      () => cb(Date.now()),
      0,
    ) as unknown as number) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number): void =>
    clearTimeout(id)) as typeof cancelAnimationFrame;
}
