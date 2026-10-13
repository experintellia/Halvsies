// The tap-safe <button>, extracted because three screens had already copied it.
// Same rule as Row.tsx: in Delta Chat's Android WebView blur fires before
// click, so activation rides onPointerUp and onClick is kept only as the
// keyboard path (Enter/Space fire a click with e.detail === 0).
import type { ComponentChildren } from "preact";

export interface TapButtonProps {
  onActivate: () => void;
  className: string;
  disabled?: boolean;
  /** For icon-only buttons, which have no visible text to name them. */
  ariaLabel?: string;
  /** -1 for a pointer-only duplicate of a control that is already focusable. */
  tabIndex?: number;
  title?: string;
  /** Id of help text that belongs to this control but isn't its name. */
  describedBy?: string;
  children: ComponentChildren;
}

export function TapButton({
  onActivate,
  className,
  disabled,
  ariaLabel,
  tabIndex,
  title,
  describedBy,
  children,
}: TapButtonProps) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      tabIndex={tabIndex}
      title={title}
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
