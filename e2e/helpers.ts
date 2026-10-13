// Shared steps for the e2e specs. Plain functions over a Page: each spec reads
// as the user's actions, and selectors live here once.
import { expect, type Locator, type Page } from "@playwright/test";

/** Opens the app as `name`. The mock host reads its identity off the hash. */
export async function openAs(page: Page, name: string): Promise<void> {
  const addr = `${name.toLowerCase()}@example.org`;
  await page.goto(`/#name=${encodeURIComponent(name)}&addr=${addr}`);
}

/**
 * Resolves with the text of the next message the app sends to the chat. The
 * mock host shows it in an alert(), which blocks the page until dismissed, so
 * this has to be armed before the tap that sends.
 */
export function captureChat(page: Page): Promise<string> {
  return new Promise((resolve) => {
    page.once("dialog", (dialog) => {
      resolve(dialog.message());
      void dialog.dismiss();
    });
  });
}

/** The bottom sheet currently open (there is only ever one on top). */
export const sheet = (page: Page): Locator => page.locator(".sheet").last();

/** The full-screen sub-page on top (the expense form, the wizard, …). */
export const subpage = (page: Page): Locator => page.locator(".subpage").last();

export async function pickCurrency(page: Page, code: string): Promise<void> {
  await page.locator(".picker-value").click();
  await page.getByPlaceholder("Code or name — EUR, krona, rupee").fill(code);
  await page
    .locator(".currency-row")
    .filter({ has: page.locator(".currency-code", { hasText: code }) })
    .first()
    .click();
  await expect(page.locator(".picker-value .currency-code")).toHaveText(code);
}

/** The first-run screen: currency, name, start. */
export async function setUpGroup(
  page: Page,
  title = "Rome trip",
  currency = "EUR",
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Set up this split" }),
  ).toBeVisible();
  await pickCurrency(page, currency);
  await page.getByLabel("Group name (optional)").fill(title);
  await page.getByRole("button", { name: "Start splitting" }).click();
  await expect(page.locator(".tab-bar")).toBeVisible();
}

export async function tab(
  page: Page,
  name: "Expenses" | "Balances" | "Me",
): Promise<void> {
  await page.locator(".tab-btn", { hasText: name }).click();
}

export async function openGroupSettings(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Group settings" }).click();
  await expect(page.locator(".subpage")).toBeVisible();
}

/** Adds a member who doesn't use the app, via group settings → Members. */
export async function addVirtualMember(
  page: Page,
  name: string,
): Promise<void> {
  await openGroupSettings(page);
  await page.getByRole("button", { name: /^Members/ }).click();
  await sheet(page).getByPlaceholder("Grandma").fill(name);
  await sheet(page).getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    sheet(page).getByLabel(`Name of ${name}`, { exact: true }),
  ).toBeVisible();
  await sheet(page).getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Back", exact: true }).click();
}

export interface NewExpense {
  amount: string;
  title: string;
  /** Member name as shown on the payer chip; defaults to whoever is preselected. */
  payer?: string;
  /** Members to leave out of an even split. */
  exclude?: string[];
}

/**
 * Opens a blank expense form, ready to type into. The form fills in its
 * defaults (today's date, the payer, amount 0) in an effect that runs after
 * the sheet paints — up to ~100ms later on a busy machine — and anything
 * typed before that would be reset. A person can't type that fast; a test can.
 */
export async function openNewExpense(page: Page): Promise<Locator> {
  await tab(page, "Expenses");
  await page.getByRole("button", { name: "Add expense" }).click();
  const form = subpage(page);
  await expect(
    form.getByRole("heading", { name: "Add expense" }),
  ).toBeVisible();
  // The form stays mounted between opens, so a date can be left over from
  // the last expense: a blank title is what says the reset has run.
  await expect(form.getByLabel("Date")).not.toHaveValue("");
  await expect(form.getByLabel("Title")).toHaveValue("");
  return form;
}

export async function addExpense(page: Page, e: NewExpense): Promise<void> {
  const form = await openNewExpense(page);
  await form.getByLabel("Amount").first().fill(e.amount);
  await form.getByLabel("Title").fill(e.title);
  if (e.payer)
    await form.getByRole("button", { name: `Paid by ${e.payer}` }).click();
  for (const name of e.exclude ?? []) {
    await form.getByRole("checkbox", { name: new RegExp(name) }).click();
  }
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".subpage")).toHaveCount(0);
}

/** Me tab → Add payment method → `option` → fill → Save. */
export async function addMethod(
  page: Page,
  option: string,
  fields: Record<string, string>,
  opts: { preferred?: boolean } = {},
): Promise<void> {
  await tab(page, "Me");
  await page.locator(".row", { hasText: "Add payment method" }).click();
  await subpage(page)
    .locator(".wizard-option", { hasText: option })
    .first()
    .click();
  for (const [label, value] of Object.entries(fields)) {
    await subpage(page).getByLabel(label).fill(value);
  }
  if (opts.preferred) {
    await subpage(page).getByLabel("Preferred way to be paid").check();
  }
  await subpage(page).getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".subpage")).toHaveCount(0);
}

/** The pay-up sheet's method switcher buttons (toggle buttons, aria-pressed). */
export const methodButtons = (scope: Locator): Locator =>
  scope.getByRole("group", { name: "Payment method" }).getByRole("button");

/** A saved method's row on the Me tab. */
export const methodRow = (page: Page, name: string): Locator =>
  page.locator(".list .row", {
    has: page.locator(".method-name", { hasText: name }),
  });
