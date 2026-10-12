import { expect, test } from "@playwright/test";
import { openAs, openGroupSettings, pickCurrency, setUpGroup } from "./helpers";

test("first run asks for currency and name, then never again", async ({
  page,
}) => {
  await openAs(page, "Anna");
  await setUpGroup(page, "Rome trip", "SEK");

  const header = page.locator(".app-header");
  await expect(header).toContainText("Rome trip");
  await expect(header).toContainText("1 person · SEK");

  // The answer lives in the shared doc, so a reload goes straight to the app.
  await page.reload();
  await expect(page.locator(".tab-bar")).toBeVisible();
  await expect(page.getByText("Set up this split")).toHaveCount(0);
});

test("opening the app without finishing setup posts nothing to the chat", async ({
  page,
}) => {
  await openAs(page, "Anna");
  await expect(page.getByText("Set up this split")).toBeVisible();
  // The mock host's update log is the chat: still empty.
  const updates = await page.evaluate(() =>
    window.localStorage.getItem("__xdcUpdatesKey__"),
  );
  expect(updates === null || updates === "[]").toBe(true);
});

test("group settings open from the name and from the gear, and edit the group", async ({
  page,
}) => {
  await openAs(page, "Anna");
  await setUpGroup(page);

  await page.locator(".group-btn").click();
  await expect(
    page.locator(".subpage").getByRole("heading", { name: "Group settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.locator(".subpage")).toHaveCount(0);

  await openGroupSettings(page);
  const name = page.getByLabel("Name (optional)");
  await name.fill("Lisbon");
  await name.blur();
  await pickCurrency(page, "GBP");
  // Escape is what a hardware Back maps to in the WebViews this ships in.
  await page.keyboard.press("Escape");
  await expect(page.locator(".subpage")).toHaveCount(0);
  await expect(page.locator(".app-header")).toContainText("Lisbon");
  await expect(page.locator(".app-header")).toContainText("GBP");
});

test("members: add, rename and remove someone who doesn't use the app", async ({
  page,
}) => {
  await openAs(page, "Anna");
  await setUpGroup(page);
  await openGroupSettings(page);
  await page.getByRole("button", { name: /^Members/ }).click();

  const sheet = page.locator(".sheet");
  await sheet.getByPlaceholder("Grandma").fill("Grandma");
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  const nameField = sheet.getByLabel("Name of Grandma");
  await expect(nameField).toBeVisible();

  await nameField.fill("Oma");
  await nameField.blur();
  await expect(sheet.getByLabel("Name of Oma")).toBeVisible();

  // Removal takes two taps: the first one arms it.
  const row = sheet.locator(".method-row", {
    has: page.getByLabel("Name of Oma"),
  });
  await row.getByRole("button", { name: "Remove" }).click();
  await row.getByRole("button", { name: "Really remove?" }).click();
  await expect(sheet.getByLabel("Name of Oma")).toHaveCount(0);
});
