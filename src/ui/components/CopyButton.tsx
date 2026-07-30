// Copies a string to the clipboard and shows a transient "Copied" state.
// External links may not open in every messenger/webview, so this is a
// first-class path (not a best-effort fallback) — it must actually work in
// older/non-secure-context webviews too, hence the textarea+execCommand path.
import { useRef, useState } from "preact/hooks";

export interface CopyButtonProps {
  /** the text copied to the clipboard */
  value: string;
  label?: string;
  copiedLabel?: string;
  className?: string;
}

function fallbackCopy(text: string): boolean {
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
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const activate = () => {
    copyText(value).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <button
      type="button"
      className={
        "btn btn-secondary copy-btn" + (className ? ` ${className}` : "")
      }
      onPointerUp={activate}
      onClick={(e) => {
        if (e.detail === 0) activate();
      }}
    >
      {copied ? copiedLabel : label}
    </button>
  );
}
