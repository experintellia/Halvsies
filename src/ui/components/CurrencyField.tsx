// The group-currency picker. A native <select>: it is the one control a
// webxdc host renders as a proper platform picker with type-ahead, which is
// what makes 160 codes usable on a phone. (<datalist> is not an option here —
// Delta Chat's Android WebView renders it as a near-full-screen popup.)
//
// Common currencies come first, so the answer is usually one tap and no
// scrolling; the rest follow under their own group.
import {
  COMMON_CURRENCIES,
  currencyCodes,
  currencyName,
} from "../../state/currency";

export interface CurrencyFieldProps {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  /** Where this came from, when it was filled in for the user. */
  hint?: string;
}

/** "SEK — Swedish Krona", or just "SEK" where the engine has no name. */
function optionLabel(code: string): string {
  const name = currencyName(code);
  return name ? `${code} — ${name}` : code;
}

export function CurrencyField({
  value,
  onChange,
  label = "Group currency",
  hint,
}: CurrencyFieldProps) {
  const current = value.toUpperCase();
  const all = currencyCodes(current);
  const common = COMMON_CURRENCIES.filter((c) => all.includes(c));
  const rest = all.filter((c) => !common.includes(c));

  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        value={current}
        onChange={(e) =>
          onChange((e.currentTarget as HTMLSelectElement).value.toUpperCase())
        }
      >
        <optgroup label="Common">
          {common.map((code) => (
            <option key={code} value={code}>
              {optionLabel(code)}
            </option>
          ))}
        </optgroup>
        {rest.length > 0 && (
          <optgroup label="All currencies">
            {rest.map((code) => (
              <option key={code} value={code}>
                {optionLabel(code)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {hint && <span className="field-suffix">{hint}</span>}
    </label>
  );
}
