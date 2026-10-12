import { expect, test } from "@playwright/test";
import {
  addMethod,
  methodButtons,
  methodRow,
  openAs,
  openGroupSettings,
  pickCurrency,
  setUpGroup,
  sheet,
  subpage,
  tab,
} from "./helpers";

const IBAN = "DE89 3704 0044 0532 0130 00";

test.beforeEach(async ({ page }) => {
  await openAs(page, "Anna");
  await setUpGroup(page);
  await tab(page, "Me");
});

test("starts with no methods, and nothing on the tab is destructive", async ({
  page,
}) => {
  await expect(page.getByText("No payment methods yet")).toBeVisible();
  await expect(page.getByText("Group settings")).toHaveCount(0);
  await expect(page.locator(".app-content .btn-danger")).toHaveCount(0);
});

test("each saved method says what a payer gets", async ({ page }) => {
  await addMethod(page, "PayPal", { "PayPal handle": "annab" });
  await addMethod(page, "Revolut", { "Revolut handle": "annab" });
  await addMethod(page, "Bank transfer", {
    IBAN,
    "Account holder name": "Anna Beispiel",
  });

  await expect(methodRow(page, "PayPal")).toContainText("annab");
  await expect(methodRow(page, "PayPal").locator(".tag")).toHaveText(
    "Fills in amount",
  );
  await expect(methodRow(page, "Revolut").locator(".tag")).toHaveText(
    "Payer types amount",
  );
  await expect(methodRow(page, "Bank transfer")).toContainText(IBAN);
  // Via its QR code, a bank transfer fills the amount in too.
  await expect(methodRow(page, "Bank transfer").locator(".tag")).toHaveText(
    "Fills in amount",
  );
  // Still no destructive buttons: Remove lives inside each method's edit view.
  await expect(page.getByRole("button", { name: /Remove/ })).toHaveCount(0);
});

test("the wizard refuses a bad IBAN and offers a test link for a good handle", async ({
  page,
}) => {
  await page.locator(".row", { hasText: "Add payment method" }).click();
  await subpage(page)
    .locator(".wizard-option", { hasText: "Bank transfer" })
    .click();
  await subpage(page)
    .getByLabel("IBAN", { exact: true })
    .fill("DE00 1234 5678");
  await expect(subpage(page).getByRole("status")).toHaveText(
    "That doesn't look like a valid IBAN.",
  );
  await expect(
    subpage(page).getByRole("button", { name: "Save" }),
  ).toBeDisabled();
  await subpage(page)
    .getByRole("button", { name: "Back", exact: true })
    .click();

  await subpage(page).locator(".wizard-option", { hasText: "PayPal" }).click();
  await subpage(page).getByLabel("PayPal handle").fill("annab");
  await expect(
    subpage(page).getByRole("link", { name: "Open test link" }),
  ).toHaveAttribute("href", "https://paypal.me/annab/10.00EUR");
});

test("a method can be marked preferred, and removed from its edit view", async ({
  page,
}) => {
  await addMethod(page, "PayPal", { "PayPal handle": "annab" });
  await addMethod(
    page,
    "Bank transfer",
    { IBAN, "Account holder name": "Anna Beispiel" },
    { preferred: true },
  );
  await expect(methodRow(page, "Bank transfer")).toContainText("Preferred");
  await expect(methodRow(page, "PayPal")).not.toContainText("Preferred");

  await methodRow(page, "PayPal").click();
  await subpage(page).getByRole("button", { name: "Remove PayPal" }).click();
  await expect(methodRow(page, "PayPal")).toHaveCount(0);
  await expect(methodRow(page, "Bank transfer")).toContainText("Preferred");
});

test("the note to payers is kept across tabs and reloads", async ({ page }) => {
  const note = page.getByLabel("Note to payers");
  await note.fill("Away until the 20th");
  await note.blur();
  await tab(page, "Expenses");
  await tab(page, "Me");
  await expect(page.getByLabel("Note to payers")).toHaveValue(
    "Away until the 20th",
  );
  await page.reload();
  await tab(page, "Me");
  await expect(page.getByLabel("Note to payers")).toHaveValue(
    "Away until the 20th",
  );
});

test("'See what payers see' is the payer's sheet, and nothing can be recorded from it", async ({
  page,
}) => {
  await addMethod(page, "PayPal", { "PayPal handle": "annab" });
  await addMethod(page, "Bank transfer", {
    IBAN,
    "Account holder name": "Anna",
  });
  await page.getByRole("button", { name: "See what payers see" }).click();

  const preview = sheet(page);
  await expect(preview.locator(".sheet-title")).toHaveText("What payers see");
  await expect(preview.locator(".sheet-amount")).toHaveText("€10.00");
  await expect(methodButtons(preview)).toHaveText(["PayPal", "Bank transfer"]);
  await expect(
    preview.getByRole("link", { name: /Open PayPal/ }),
  ).toHaveAttribute("href", "https://paypal.me/annab/10.00EUR");
  await expect(preview).toContainText("Nothing here is recorded or sent.");
  await expect(
    preview.getByRole("button", { name: /Mark as|I'm paying now/ }),
  ).toHaveCount(0);
});

test("a method the group currency can't use says why", async ({ page }) => {
  await addMethod(page, "bunq", { "bunq handle": "anna" });
  await openGroupSettings(page);
  await pickCurrency(page, "SEK");
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await tab(page, "Me");

  await expect(methodRow(page, "bunq")).toContainText(
    "EUR only — not offered for SEK debts",
  );
  await expect(
    page.getByText("None of your saved methods work for SEK debts"),
  ).toBeVisible();
});
