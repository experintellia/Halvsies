import { expect, test } from "@playwright/test";
import {
  addExpense,
  addVirtualMember,
  openAs,
  subpage,
  setUpGroup,
  sheet,
  tab,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await openAs(page, "Anna");
  await setUpGroup(page);
});

test("nothing to settle before the first expense", async ({ page }) => {
  await tab(page, "Balances");
  await expect(
    page.getByRole("heading", { name: "Nothing to settle" }),
  ).toBeVisible();
});

test("you owe one person: pay them, record it, and the group is all square", async ({
  page,
}) => {
  await addVirtualMember(page, "Ben");
  await addExpense(page, { amount: "50", title: "Groceries", payer: "Ben" });
  await tab(page, "Balances");

  const hero = page.locator(".hero");
  await expect(hero).toContainText("You owe Ben");
  await expect(hero.locator(".hero-amount")).toHaveText("€25.00");
  await expect(hero).toContainText("One payment settles you up");

  // Everyone's position is a static list, not buttons.
  const everyone = page.locator(".list", {
    has: page.locator(".position-bar"),
  });
  await expect(everyone.locator(".row", { hasText: "Ben" })).toContainText(
    "+€25.00",
  );
  await expect(everyone.locator(".row", { hasText: "You" })).toContainText(
    "-€25.00",
  );
  await expect(everyone.getByRole("button")).toHaveCount(0);

  await hero.getByRole("button", { name: "Pay Ben" }).click();
  await expect(sheet(page).locator(".sheet-title")).toHaveText("You owe Ben");
  // Ben was added by hand: he can't add details himself.
  await expect(sheet(page)).toContainText(
    "Ben doesn't use Halvsies, so there are no payment details on file.",
  );

  await sheet(page).getByRole("button", { name: "Mark as paid" }).click();
  await expect(sheet(page)).toContainText("Record that you paid Ben €25.00?");
  await sheet(page).getByRole("button", { name: "Yes, record it" }).click();

  await expect(page.getByRole("heading", { name: "All square" })).toBeVisible();
});

test("owed by several, with a debt between two others listed separately", async ({
  page,
}) => {
  await addVirtualMember(page, "Ben");
  await addVirtualMember(page, "Chloé");
  // Anna +20, Ben -10, Chloé -10 …
  await addExpense(page, { amount: "30", title: "Museum" });
  // … then Ben +20, Chloé -20: Chloé ends up owing Anna 20 and Ben 10.
  await addExpense(page, {
    amount: "40",
    title: "Dinner",
    payer: "Ben",
    exclude: ["Anna"],
  });
  await tab(page, "Balances");

  const hero = page.locator(".hero");
  await expect(hero).toContainText("Chloé owes you");
  await expect(hero.locator(".hero-amount")).toHaveText("€20.00");

  const others = page.locator(".list", { hasText: "→" });
  await expect(others.getByRole("button")).toHaveCount(1);
  await expect(others).toContainText("Chloé → Ben");
  await expect(others).toContainText("€10.00");
  await expect(
    page.getByText("2 payments settle the whole group."),
  ).toBeVisible();

  // Someone else's debt — but both were added by hand and can't record it
  // themselves, so anyone in the group may. (A debt with a party who uses
  // the app stays read-only for everyone else: unit test C10.)
  await others.getByRole("button").click();
  await expect(sheet(page).locator(".sheet-title")).toHaveText(
    "Chloé owes Ben",
  );
  await expect(sheet(page)).not.toContainText("can record this payment");
  await sheet(page).getByRole("button", { name: "Mark as paid" }).click();
  await expect(sheet(page)).toContainText("Record that Chloé paid Ben €10.00?");
  await sheet(page).getByRole("button", { name: "Cancel" }).click();
  await sheet(page).getByRole("button", { name: "Close" }).click();

  // Your own credit, from someone who isn't in this chat: a chat message
  // would never reach her, so the request is copied for elsewhere instead.
  await hero.getByRole("button", { name: "Ask Chloé to pay" }).click();
  await expect(sheet(page).locator(".sheet-title")).toHaveText(
    "Chloé owes you",
  );
  await expect(sheet(page)).toContainText("Chloé isn't in this chat.");
  await expect(
    sheet(page).getByRole("button", { name: "Ask for the money" }),
  ).toHaveCount(0);
  await expect(
    sheet(page).getByRole("button", { name: "Copy request" }),
  ).toBeVisible();
  await expect(
    sheet(page).getByRole("button", { name: "Mark as received" }),
  ).toBeVisible();
});

test("keyboard: a second Enter on Mark as paid doesn't skip the confirmation", async ({
  page,
}) => {
  await addVirtualMember(page, "Ben");
  await addExpense(page, { amount: "50", title: "Groceries", payer: "Ben" });
  await tab(page, "Balances");
  await page.getByRole("button", { name: "Pay Ben" }).click();

  await sheet(page).getByRole("button", { name: "Mark as paid" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(
    sheet(page).getByRole("button", { name: "Yes, record it" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "All square" })).toHaveCount(
    0,
  );
});

test("someone who doesn't use the app: add their details from the pay sheet", async ({
  page,
}) => {
  await addVirtualMember(page, "Ben");
  await addExpense(page, { amount: "50", title: "Groceries", payer: "Ben" });
  await tab(page, "Balances");
  await page.getByRole("button", { name: "Pay Ben" }).click();

  await sheet(page)
    .getByRole("button", { name: "Add Ben's payment details" })
    .click();
  await expect(
    subpage(page).getByRole("heading", { name: "Ben's payment details" }),
  ).toBeVisible();
  await expect(subpage(page)).toContainText("How the group pays Ben back");
  await subpage(page)
    .locator(".row", { hasText: "Add payment method" })
    .click();
  await subpage(page).locator(".wizard-option", { hasText: "PayPal" }).click();
  await subpage(page).getByLabel("PayPal handle").fill("benb");
  await subpage(page).getByRole("button", { name: "Save" }).click();
  await expect(subpage(page)).toContainText("PayPal");

  // Back lands on the same pay sheet, now with Ben's link.
  await subpage(page)
    .getByRole("button", { name: "Back", exact: true })
    .click();
  await expect(sheet(page).locator(".sheet-title")).toHaveText("You owe Ben");
  await expect(
    sheet(page).getByRole("link", { name: /Open PayPal/ }),
  ).toHaveAttribute("href", /paypal\.me\/benb\/25\.00EUR/);
  await expect(
    sheet(page).getByRole("button", { name: "Edit Ben's payment details" }),
  ).toBeVisible();
  await sheet(page).getByRole("button", { name: "Close" }).click();

  // Stored under Ben, not you.
  await tab(page, "Me");
  await expect(page.getByText("No payment methods yet.")).toBeVisible();
});
