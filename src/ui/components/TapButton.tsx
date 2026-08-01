// The tap-safe <button>, extracted because three screens had already copied it.
// Same rule as Row.tsx: in Delta Chat's Android WebView blur fires before
// click, so activation rides onPointerUp and onClick is kept only as the
// keyboard path (Enter/Space fire a click with e.detail === 0).
import type { ComponentChildren } from "preact";

export interface TapButtonProps {
  onActivate: () => void;
  className: string;
  disabled?: boolean;
  children: ComponentChildren;
}

export function TapButton({
  onActivate,
  className,
  disabled,
  children,
}: TapButtonProps) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onPointerUp={() => {
        if (!disabled) onActivate();
      }}
      onClick={(e) => {
        if (e.detail === 0 && !disabled) onActivate();
      }}
    >
      {children}
    </button>
  );
}
