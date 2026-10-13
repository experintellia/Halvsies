import { expect, test } from "@playwright/test";
import {
  addExpense,
  addVirtualMember,
  openAs,
  captureChat,
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
  await expect(sheet(page)).toContainText(
    "Ben hasn't added any payment details yet",
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

  // Someone else's debt is read-only for you.
  await others.getByRole("button").click();
  await expect(sheet(page).locator(".sheet-title")).toHaveText(
    "Chloé owes Ben",
  );
  await expect(sheet(page)).toContainText(
    "Only Chloé or Ben can record this payment.",
  );
  await expect(
    sheet(page).getByRole("button", { name: /Mark as/ }),
  ).toHaveCount(0);
  await sheet(page).getByRole("button", { name: "Close" }).click();

  // Your own credit: a nudge with every way to pay, and "received" to record.
  await hero.getByRole("button", { name: "Ask Chloé to pay" }).click();
  await expect(sheet(page).locator(".sheet-title")).toHaveText(
    "Chloé owes you",
  );
  // The mock host "sends to chat" by alert()ing the message.
  const sent = captureChat(page);
  await sheet(page).getByRole("button", { name: "Ask for the money" }).click();
  expect(await sent).toContain("Hey Chloé — €20.00 whenever you get a chance");
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
