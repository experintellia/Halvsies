import { expect, test } from "@playwright/test";
import {
  addExpense,
  addVirtualMember,
  openAs,
  openNewExpense,
  setUpGroup,
  sheet,
} from "./helpers";

test.beforeEach(async ({ page }) => {
  await openAs(page, "Anna");
  await setUpGroup(page);
  await addVirtualMember(page, "Ben");
});

test("starts empty, with a way to add the first expense", async ({ page }) => {
  await expect(
    page.getByRole("heading", { name: "No expenses yet" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Add expense" })).toBeVisible();
});

test("an even split shows up in the list, the totals and the day total", async ({
  page,
}) => {
  await addExpense(page, { amount: "60", title: "Dinner" });

  const row = page.locator(".row", { hasText: "Dinner" });
  await expect(row).toContainText("You paid");
  await expect(row).toContainText("€60.00");
  await expect(row).toContainText("Your share €30.00");

  const summary = page.locator(".summary");
  await expect(summary).toContainText("Group spend€60.00");
  await expect(summary).toContainText("Your share€30.00");
  await expect(page.locator(".day-heading").first()).toContainText("€60.00");
});

test("a bigger expense gets a longer bar", async ({ page }) => {
  await addExpense(page, { amount: "100", title: "Flat" });
  await addExpense(page, { amount: "10", title: "Gelato" });

  const width = (title: string) =>
    page
      .locator(".row", { hasText: title })
      .locator(".amount-bar")
      .evaluate((el) => el.getBoundingClientRect().width);
  expect(await width("Flat")).toBeGreaterThan((await width("Gelato")) * 5);
});

test("a row opens a read-only summary; editing by shares and deleting both work", async ({
  page,
}) => {
  await addExpense(page, { amount: "60", title: "Taxi" });

  await page.locator(".row", { hasText: "Taxi" }).click();
  await expect(sheet(page)).toContainText("Split evenly");
  await expect(sheet(page).getByRole("button", { name: "Save" })).toHaveCount(
    0,
  );

  await sheet(page).getByRole("button", { name: "Edit" }).click();
  const form = sheet(page);
  await form.getByRole("button", { name: "Shares" }).click();
  await form
    .getByRole("group", { name: "Shares for Ben" })
    .getByRole("button", { name: "+" })
    .click();
  await expect(form).toContainText("2 shares · 67%");
  await form.getByRole("button", { name: "Save" }).click();

  await page.locator(".row", { hasText: "Taxi" }).click();
  await expect(sheet(page)).toContainText("Split by shares");
  await expect(
    sheet(page).locator(".detail-share", { hasText: "Ben" }),
  ).toContainText("€40.00");

  await sheet(page).getByRole("button", { name: "Edit" }).click();
  // Two taps: the first one only arms it.
  await sheet(page).getByRole("button", { name: "Delete" }).click();
  await sheet(page).getByRole("button", { name: "Really delete?" }).click();
  await expect(
    page.getByRole("heading", { name: "No expenses yet" }),
  ).toBeVisible();
});

test("an exact split must add up before it can be saved", async ({ page }) => {
  const form = await openNewExpense(page);
  await form.getByLabel("Amount").first().fill("50");
  await form.getByLabel("Title").fill("Tickets");
  await form.getByRole("button", { name: "Exact" }).click();

  const exact = (name: string) =>
    form.locator(".split-member", { hasText: name }).getByLabel("Amount");
  await exact("Anna").fill("20");
  await exact("Ben").fill("20");
  await expect(form).toContainText("€10.00 left to assign");
  await expect(form.getByRole("button", { name: "Save" })).toBeDisabled();

  await exact("Ben").fill("30");
  await expect(form).toContainText("All assigned");
  await form.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".row", { hasText: "Tickets" })).toContainText(
    "Your share €20.00",
  );
});

// Every tap target activates on pointerup (Delta Chat's WebView fires blur
// before click); Enter has to keep working through the e.detail === 0 path.
//
// Each starts from a fresh load: closing a sheet or sub-page hands focus back
// to its opener in an effect that can land ~100ms later on a busy machine, so
// the members sheet and group settings beforeEach used could otherwise pull
// focus away from under the keypress.
test("Enter on the add button opens the form", async ({ page }) => {
  await page.reload();
  const add = page.getByRole("button", { name: "Add expense" });
  await add.focus();
  await expect(add).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    sheet(page).getByRole("heading", { name: "Add expense" }),
  ).toBeVisible();
});

test("Enter on a tab switches to it", async ({ page }) => {
  await page.reload();
  const me = page.locator(".tab-btn", { hasText: "Me" });
  await me.focus();
  await expect(me).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("How the group pays you back")).toBeVisible();
});
