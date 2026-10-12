// Two people in one chat: two pages in one browser context share the mock
// host's update log, the same way two phones share a chat.
import { expect, test } from "@playwright/test";
import {
  addExpense,
  addMethod,
  captureChat,
  openAs,
  setUpGroup,
  sheet,
  tab,
} from "./helpers";

test("an expense, a profile and a payment all reach the other person", async ({
  page: anna,
  context,
}) => {
  await openAs(anna, "Anna");
  await setUpGroup(anna, "Rome trip");

  // Ben joins later: no setup screen for him, the group is already configured.
  const ben = await context.newPage();
  await openAs(ben, "Ben");
  await expect(ben.locator(".app-header")).toContainText("Rome trip");
  await expect(anna.locator(".app-header")).toContainText("2 people");

  // Ben's payment details, with the bank transfer marked preferred.
  await addMethod(ben, "PayPal", { "PayPal handle": "benb" });
  await addMethod(
    ben,
    "Bank transfer",
    {
      IBAN: "DE89 3704 0044 0532 0130 00",
      "Account holder name": "Ben Beispiel",
    },
    { preferred: true },
  );
  const note = ben.getByLabel("Note to payers");
  await note.fill("IBAN is easiest for me");
  await note.blur();

  // Ben pays for dinner; Anna sees it and owes half.
  await addExpense(ben, { amount: "100", title: "Dinner" });
  await tab(anna, "Expenses");
  await expect(anna.locator(".row", { hasText: "Dinner" })).toContainText(
    "Ben paid",
  );
  await tab(anna, "Balances");
  await expect(anna.locator(".hero")).toContainText("You owe Ben");
  await expect(anna.locator(".hero-amount")).toHaveText("€50.00");

  // Anna's pay-up sheet opens on Ben's preferred method, with his note on top.
  await anna.getByRole("button", { name: "Pay Ben" }).click();
  const payup = sheet(anna);
  await expect(payup.locator(".payee-note")).toContainText(
    "IBAN is easiest for me",
  );
  await expect(payup.getByRole("tab")).toHaveText(["Bank transfer", "PayPal"]);
  await expect(
    payup.getByRole("tab", { name: "Bank transfer" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(payup).toContainText("Ben's preferred way to be paid");
  await expect(payup.locator("svg.qr-code")).toHaveCount(1);
  await expect(payup.locator("input.copy-input").nth(1)).toHaveValue(
    "DE89 3704 0044 0532 0130 00",
  );

  // Switching shows one method at a time: PayPal, with the amount filled in.
  await payup.getByRole("tab", { name: "PayPal" }).click();
  await expect(
    payup.getByRole("link", { name: /Open PayPal/ }),
  ).toHaveAttribute("href", "https://paypal.me/benb/50.00EUR");
  await expect(payup.locator("svg.qr-code")).toHaveCount(1);
  await expect(payup).toContainText("€50.00 is filled in");

  // One primary action: opening PayPal, until the payer has.
  await expect(payup.getByRole("link", { name: /Open PayPal/ })).toHaveClass(
    /btn-primary/,
  );
  await expect(payup.getByRole("button", { name: "Mark as paid" })).toHaveClass(
    /btn-secondary/,
  );

  await payup.getByRole("button", { name: "Copy PayPal link" }).click();
  await expect(payup.getByRole("button", { name: "Copied" })).toBeVisible();

  const sent = captureChat(anna);
  await payup.getByRole("button", { name: "I'm paying now" }).click();
  expect(await sent).toContain(
    "Paying Ben €50.00 now — https://paypal.me/benb/50.00EUR",
  );

  // Having said how they pay, recording it is now the main action.
  await expect(payup.getByRole("button", { name: "Mark as paid" })).toHaveClass(
    /btn-primary/,
  );
  await payup.getByRole("button", { name: "Mark as paid" }).click();
  await payup.getByRole("button", { name: "Yes, record it" }).click();
  await expect(anna.getByRole("heading", { name: "All square" })).toBeVisible();

  // …and Ben's screen agrees.
  await tab(ben, "Balances");
  await expect(ben.getByRole("heading", { name: "All square" })).toBeVisible();
});
