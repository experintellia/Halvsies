// Tiny Preact hook wrapping state/doc's subscribe(). Preact ships no
// useSyncExternalStore in its own hooks module (only preact/compat has one,
// and pulling in the whole compat shim for a single hook isn't worth it here)
// — a force-update counter bumped on every doc change is the same thing in
// ~8 lines.
import { useEffect, useState } from "preact/hooks";
import { subscribe } from "../state/doc";

/** Re-renders the calling component on any doc change, then returns read(). */
export function useDocValue<T>(read: () => T): T {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
  return read();
}
