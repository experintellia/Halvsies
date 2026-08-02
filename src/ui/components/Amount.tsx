// Money input that works entirely in integer cents. Money never becomes a
// float here: `parseAmountInput` is the only place text turns into a number,
// and it always returns an integer or null (never NaN).
import { useEffect, useRef, useState } from "preact/hooks";
import { MAX_AMOUNT_CENTS } from "../../state/balances";

export interface AmountProps {
  valueCents: number;
  onChange: (cents: number) => void;
  currency: string;
  autoFocus?: boolean;
  label: string;
}

/**
 * Parses user-typed amount text into integer cents. Accepts "," or "." as the
 * decimal separator, strips currency symbols/spaces, truncates (never rounds
 * up) beyond 2 decimals, rejects negative amounts, and never returns NaN.
 * Returns `null` for input that isn't a parseable amount (caller should keep
 * the previously committed value); returns 0 for an empty string.
 */
export function parseAmountInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;

  const s = trimmed.replace(/[^0-9.,-]/g, "");
  if (s === "" || s.indexOf("-") !== -1) return null; // no negative amounts

  const sepIdx = Math.max(s.lastIndexOf("."), s.lastIndexOf(","));
  let intPart: string;
  let fracPart: string;
  if (sepIdx === -1) {
    intPart = s;
    fracPart = "";
  } else {
    intPart = s.slice(0, sepIdx).replace(/[.,]/g, "");
    fracPart = s
      .slice(sepIdx + 1)
      .replace(/[.,]/g, "")
      .slice(0, 2);
  }
  if (intPart === "") intPart = "0";
  if (!/^\d+$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;

  const cents =
    parseInt(intPart, 10) * 100 +
    (fracPart ? parseInt(fracPart.padEnd(2, "0"), 10) : 0);
  if (!Number.isFinite(cents)) return null;
  // Reject rather than clamp: past MAX_AMOUNT_CENTS the split math would leave
  // exact-integer land, and silently rewriting someone's amount is worse than
  // refusing the keystroke (the caller keeps the last committed value).
  if (cents > MAX_AMOUNT_CENTS) return null;
  return cents;
}

function formatForEdit(cents: number): string {
  return cents === 0 ? "" : (cents / 100).toFixed(2);
}

export function Amount({
  valueCents,
  onChange,
  currency,
  autoFocus,
  label,
}: AmountProps) {
  const [text, setText] = useState(() => formatForEdit(valueCents));
  // Typed in, not merely focused. This field is autofocused the instant the
  // expense sheet opens — which happens *before* the sheet's init effect
  // writes the expense being edited into `valueCents` — so treating focus as
  // ownership showed an empty amount box for every edit. Only a keystroke
  // means the text is the user's; until then it must follow the value.
  const typed = useRef(false);

  // Follow external value changes (e.g. a parent resetting the form) as long
  // as the user isn't part-way through an amount of their own.
  useEffect(() => {
    if (!typed.current) setText(formatForEdit(valueCents));
  }, [valueCents]);

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-row">
        <input
          className="amount-input"
          type="text"
          inputMode="decimal"
          autoFocus={autoFocus}
          value={text}
          onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
          onBlur={() => {
            typed.current = false;
            setText(formatForEdit(valueCents));
          }}
          onInput={(e) => {
            const raw = (e.currentTarget as HTMLInputElement).value;
            typed.current = true;
            setText(raw);
            const cents = parseAmountInput(raw);
            if (cents !== null) onChange(cents);
          }}
        />
        <span className="field-suffix">{currency}</span>
      </span>
    </label>
  );
}
