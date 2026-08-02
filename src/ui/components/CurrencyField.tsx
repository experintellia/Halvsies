// The group-currency picker: a value button that opens a searchable sheet.
//
// Not a <select>: 162 options is a long native picker with no way to type
// "krona". Not a <datalist> either — CLAUDE.md rules it out on Delta Chat
// Android, where it renders as a near-full-screen popup.
//
// The tap handling is the whole game here. A search field is focused while you
// reach for a result, and Delta Chat's Android WebView fires `blur` before
// `click` — so a list that closed itself on blur would swallow every tap. This
// one has no onBlur at all: rows are <Row>s, which arm on pointerdown and fire
// on pointerup, and the sheet is closed only by picking something, by the
// backdrop, or by Escape.
import { useState } from "preact/hooks";
import {
  COMMON_CURRENCIES,
  currencyCodes,
  currencyName,
  searchCurrencies,
} from "../../state/currency";
import { Sheet } from "./Sheet";
import { Row } from "./Row";
import { Icon } from "./Icon";
import { TapButton } from "./TapButton";

export interface CurrencyFieldProps {
  value: string;
  onChange: (code: string) => void;
  label?: string;
  /** Where this came from, when it was filled in for the user. */
  hint?: string;
}

function CurrencyRow({
  code,
  selected,
  onPick,
}: {
  code: string;
  selected: boolean;
  onPick: (code: string) => void;
}) {
  const name = currencyName(code);
  return (
    <Row
      role="option"
      aria-selected={selected}
      className={"currency-row" + (selected ? " selected" : "")}
      onActivate={() => onPick(code)}
    >
      <span className="money currency-code">{code}</span>
      <span className="row-text">{name ?? ""}</span>
      {selected && <Icon name="check" size={16} strokeWidth={3} />}
    </Row>
  );
}

function CurrencyPicker({
  open,
  current,
  onPick,
  onClose,
}: {
  open: boolean;
  current: string;
  onPick: (code: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  // Sheet renders null when closed but this stays mounted, so a previous
  // visit's query would still be filtering the list on the next open.
  const [lastOpen, setLastOpen] = useState(open);
  if (lastOpen !== open) {
    setLastOpen(open);
    setQuery("");
  }

  const all = currencyCodes(current);
  const matches = searchCurrencies(all, query);
  // With no query, the ones people actually use come first — otherwise the
  // list opens on AED and EUR is a scroll away.
  const common = query ? [] : COMMON_CURRENCIES.filter((c) => all.includes(c));
  const rest = query ? matches : all.filter((c) => !common.includes(c));

  return (
    <Sheet open={open} onClose={onClose} title="Choose a currency">
      <label className="field currency-search">
        <span className="field-label">Search</span>
        <span className="field-row">
          <Icon name="search" size={18} />
          <input
            type="text"
            autoFocus
            inputMode="search"
            placeholder="Code or name — EUR, krona, rupee"
            value={query}
            onInput={(e) =>
              setQuery((e.currentTarget as HTMLInputElement).value)
            }
            // Enter picks the top hit, so a hardware keyboard never has to
            // reach for the list at all.
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches.length > 0) {
                e.preventDefault();
                onPick(matches[0]);
              }
            }}
          />
        </span>
      </label>

      <div role="listbox" aria-label="Currencies" className="currency-list">
        {common.length > 0 && (
          <>
            <p className="picker-section">Common</p>
            {common.map((code) => (
              <CurrencyRow
                key={code}
                code={code}
                selected={code === current}
                onPick={onPick}
              />
            ))}
            <p className="picker-section">All currencies</p>
          </>
        )}
        {rest.map((code) => (
          <CurrencyRow
            key={code}
            code={code}
            selected={code === current}
            onPick={onPick}
          />
        ))}
        {matches.length === 0 && (
          <p className="placeholder">
            No currency matches “{query}”. Codes are three letters, e.g. EUR.
          </p>
        )}
      </div>
    </Sheet>
  );
}

export function CurrencyField({
  value,
  onChange,
  label = "Group currency",
  hint,
}: CurrencyFieldProps) {
  const [open, setOpen] = useState(false);
  const current = value.toUpperCase();
  const name = currencyName(current);

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <TapButton className="picker-value" onActivate={() => setOpen(true)}>
        <span className="money currency-code">{current}</span>
        <span className="row-text">{name ?? "Choose a currency"}</span>
        <Icon name="chevron-down" size={18} />
      </TapButton>
      {hint && <span className="field-suffix">{hint}</span>}

      <CurrencyPicker
        open={open}
        current={current}
        onClose={() => setOpen(false)}
        onPick={(code) => {
          onChange(code);
          setOpen(false);
        }}
      />
    </div>
  );
}
