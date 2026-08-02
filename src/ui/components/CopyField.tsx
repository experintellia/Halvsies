// A labelled, read-only value with a Copy button — an IBAN, a payment
// reference, an account holder, a wallet address.
//
// A real <input readOnly> rather than a <span>, on purpose: it gives long-press
// select-all and the platform's own copy affordance for free. That matters
// because the clipboard API is unavailable in some webviews (see
// CopyButton.tsx's execCommand fallback), and when even that fails, being able
// to select the text by hand is the last thing standing between the payer and
// retyping an IBAN from a screenshot. readOnly, not disabled: a disabled input
// is unselectable and skipped by screen readers.
import { CopyButton } from "./CopyButton";

export interface CopyFieldProps {
  label: string;
  value: string;
  /** Defaults to `label`; set when the field label alone reads oddly. */
  copyName?: string;
}

export function CopyField({ label, value, copyName }: CopyFieldProps) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-row">
        <input
          className="copy-input"
          type="text"
          readOnly
          value={value}
          // Desktop convenience; on a phone the long-press menu does this.
          onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        />
        <CopyButton
          value={value}
          label="Copy"
          ariaLabel={`Copy ${copyName ?? label}`}
        />
      </span>
    </label>
  );
}
