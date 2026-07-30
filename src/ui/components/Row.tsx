// The shared tappable list-row primitive. Implements the Delta Chat Android
// WebView tap rule ONCE: blur fires before click there, so anything that
// could unmount on blur (e.g. a row near a focused input) never receives its
// click — activate on onPointerUp instead, and keep onClick only as the
// keyboard-activation path (Enter/Space fire a click with e.detail === 0).
//
// A plain onPointerUp would also fire after a scroll gesture that happens to
// end over the row, so a press is only "armed" if the pointer stayed down
// inside the row the whole time (matches the pattern already proven in the
// ordered-shopping-list sibling app's suggestion-list buttons).
import type { ComponentChildren, JSX } from "preact";
import { useRef } from "preact/hooks";

type PassThrough = Omit<
  JSX.HTMLAttributes<HTMLButtonElement>,
  | "onClick"
  | "onPointerUp"
  | "onPointerDown"
  | "onPointerLeave"
  | "onPointerCancel"
  | "children"
>;

export interface RowProps extends PassThrough {
  onActivate: () => void;
  children: ComponentChildren;
}

export function Row({ onActivate, children, className, ...aria }: RowProps) {
  const armed = useRef(false);

  return (
    <button
      type="button"
      className={"row" + (className ? ` ${className}` : "")}
      onPointerDown={() => {
        armed.current = true;
      }}
      onPointerLeave={() => {
        armed.current = false;
      }}
      onPointerCancel={() => {
        armed.current = false;
      }}
      onPointerUp={() => {
        if (!armed.current) return;
        armed.current = false;
        onActivate();
      }}
      onClick={(e) => {
        if (e.detail === 0) onActivate();
      }}
      {...aria}
    >
      {children}
    </button>
  );
}
