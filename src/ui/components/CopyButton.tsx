// Copies a string to the clipboard and shows a transient "Copied" state.
// External links may not open in every messenger/webview, so this is a
// first-class path (not a best-effort fallback) — it must actually work in
// older/non-secure-context webviews too, hence the textarea+execCommand path.
import { useRef, useState } from "preact/hooks";
import { Icon } from "./Icon";
import { announce } from "../announce";

export interface CopyButtonProps {
  /** the text copied to the clipboard */
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
  /** Set when several Copy buttons share a screen and "Copy" alone is ambiguous. */
  ariaLabel?: string;
  /** Render a copy glyph (a tick once copied) instead of the text label.
   *  Needs `ariaLabel`, since there is no visible text left to name it. */
  icon?: boolean;
}

function fallbackCopy(text: string): boolean {
  // The textarea takes focus to be selected; hand it back afterwards, or a
  // keyboard or screen-reader user is left on <body>.
  const prev = document.activeElement;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  if (prev instanceof HTMLElement) prev.focus();
  return ok;
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through — older/non-secure-context webviews reject this
    }
  }
  return fallbackCopy(text);
}

export function CopyButton({
  value,
  label = "Copy",
  copiedLabel = "Copied",
  className,
  ariaLabel,
  icon,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const activate = () => {
    copyText(value).then((ok) => {
      if (!ok) {
        announce("Couldn't copy. Select the text and copy it by hand.");
        return;
      }
      announce("Copied");
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      className={
        (icon ? "copy-icon copy-btn" : "btn btn-secondary copy-btn") +
        (className ? ` ${className}` : "")
      }
      aria-label={icon && copied ? copiedLabel : ariaLabel}
      onPointerUp={activate}
      onClick={(e) => {
        if (e.detail === 0) activate();
      }}
    >
      {icon ? (
        <Icon name={copied ? "check" : "copy"} size={18} />
      ) : copied ? (
        copiedLabel
      ) : (
        label
      )}
    </button>
  );
}
