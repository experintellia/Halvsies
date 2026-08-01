// Tiny Preact hook wrapping state/doc's subscribe(). Preact ships no
// useSyncExternalStore in its own hooks module (only preact/compat has one,
// and pulling in the whole compat shim for a single hook isn't worth it here)
// — a force-update counter bumped on every doc change is the same thing in
// ~8 lines.
import { useEffect, useState } from "preact/hooks";
import { ensureSelfRegistered, subscribe } from "../state/doc";
import type { MemberId } from "../state/model";

/** Re-renders the calling component on any doc change, then returns read(). */
export function useDocValue<T>(read: () => T): T {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((n) => n + 1)), []);
  return read();
}

/**
 * The local user's member id, once self-registration completes. Undefined
 * outside a webxdc host (vitest/SSR) or for the one render before the effect
 * below has run. Registration itself is idempotent (main.tsx already did it
 * at startup) — this is the hook that makes the id reactive.
 */
export function useSelfId(): MemberId | undefined {
  const [id, setId] = useState<MemberId | undefined>(undefined);
  useEffect(() => {
    try {
      setId(ensureSelfRegistered().id);
    } catch {
      // no webxdc host — leave undefined (tests / SSR)
    }
  }, []);
  return id;
}
