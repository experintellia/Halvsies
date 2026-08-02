import { afterEach, describe, expect, it } from "vitest";
import { render } from "preact";
import { Amount, parseAmountInput } from "../src/ui/components/Amount";

describe("parseAmountInput", () => {
  it("accepts a comma decimal separator", () => {
    expect(parseAmountInput("12,50")).toBe(1250);
  });

  it("accepts a dot decimal separator", () => {
    expect(parseAmountInput("12.5")).toBe(1250);
  });

  it("keeps a leading-zero fraction", () => {
    expect(parseAmountInput("0.05")).toBe(5);
  });

  it("truncates a third decimal instead of rounding up", () => {
    expect(parseAmountInput("12.999")).toBe(1299);
  });

  it("strips currency symbols and spaces", () => {
    expect(parseAmountInput("€ 12,50")).toBe(1250);
  });

  it("treats an empty string as zero", () => {
    expect(parseAmountInput("")).toBe(0);
  });

  it("rejects non-numeric input instead of producing NaN", () => {
    expect(parseAmountInput("abc")).toBeNull();
  });

  it("rejects negative amounts", () => {
    expect(parseAmountInput("-5")).toBeNull();
  });

  it("never returns NaN or a float for any input", () => {
    for (const s of ["", "abc", "-5", "12,50", "0.05", "€12.999", "..", "-"]) {
      const v = parseAmountInput(s);
      if (v !== null) expect(Number.isInteger(v)).toBe(true);
    }
  });
});

// The expense sheet autofocuses this field the moment it opens, and only then
// does its init effect write the expense being edited. Whatever guards the
// text against outside writes therefore cannot be "is focused" — that was true
// before the amount ever arrived, and every edit opened showing an empty box.
describe("Amount follows the value until the user types", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const input = () => host.querySelector("input") as HTMLInputElement;
  const show = (cents: number) =>
    render(
      <Amount
        label="Amount"
        valueCents={cents}
        onChange={() => {}}
        currency="EUR"
        autoFocus
      />,
      host,
    );
  const type = (text: string) => {
    input().value = text;
    input().dispatchEvent(new Event("input", { bubbles: true }));
  };
  // Preact defers passive effects past a frame; test/setup.ts's rAF shim makes
  // them land on the next macrotasks rather than never.
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  };

  afterEach(() => render(null, host));

  it("picks up a value that arrives after focus", async () => {
    show(0);
    input().focus();
    show(3200);
    await settle();
    expect(input().value).toBe("32.00");
  });

  it("does not clobber a half-typed amount", async () => {
    show(0);
    input().focus();
    type("12,");
    show(9999); // e.g. a remote update landing mid-keystroke
    await settle();
    expect(input().value).toBe("12,");
  });

  it("re-formats from the committed value on blur", async () => {
    show(0);
    input().focus();
    type("12,5");
    render(
      <Amount
        label="Amount"
        valueCents={1250}
        onChange={() => {}}
        currency="EUR"
      />,
      host,
    );
    await settle();
    input().dispatchEvent(new Event("blur", { bubbles: true }));
    await settle();
    expect(input().value).toBe("12.50");
  });
});
