import { expect, test, type Page } from "@playwright/test";
import { openAs, openGroupSettings, pickCurrency, setUpGroup } from "./helpers";

/** The mock host's update log: what this "chat" has been sent so far. */
const chatLog = (page: Page): Promise<unknown[]> =>
  page.evaluate(
    () =>
      JSON.parse(
        window.localStorage.getItem("__xdcUpdatesKey__") ?? "[]",
      ) as unknown[],
  );

test("first run asks for currency and name, then never again", async ({
  page,
}) => {
  await openAs(page, "Anna");
  await setUpGroup(page, "Rome trip", "SEK");

  const header = page.locator(".app-header");
  await expect(header).toContainText("Rome trip");
  await expect(header).toContainText("1 person · SEK");

  // Finishing setup is what may write to the chat (and does): this also
  // proves chatLog reads the right key, so the empty check below means it.
  await expect
    .poll(async () => (await chatLog(page)).length)
    .toBeGreaterThan(0);

  // The answer lives in the shared doc, so a reload goes straight to the app.
  await page.reload();
  await expect(page.locator(".tab-bar")).toBeVisible();
  await expect(page.getByText("Set up this split")).toHaveCount(0);
});

test("opening the app without finishing setup posts nothing to the chat", async ({
  page,
}) => {
  // A fake clock, so the provider's periodic autosave (10s) and any delayed
  // write get their chance to fire before the log is read.
  await page.clock.install();
  await openAs(page, "Anna");
  await expect(page.getByText("Set up this split")).toBeVisible();
  await page.clock.runFor(15_000);
  expect(await chatLog(page)).toEqual([]);
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
  const name = page.getByLabel("Group name (optional)");
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
  await row.getByRole("button", { name: "Remove Oma" }).click();
  await row.getByRole("button", { name: "Really remove Oma" }).click();
  await expect(sheet.getByLabel("Name of Oma")).toHaveCount(0);
});

test("members: claiming Grandma is confirmed, then merges her into you", async ({
  page,
}) => {
  await openAs(page, "Anna");
  await setUpGroup(page);
  await openGroupSettings(page);
  await page.getByRole("button", { name: /^Members/ }).click();

  const sheet = page.locator(".sheet");
  await sheet.getByPlaceholder("Grandma").fill("Grandma");
  await sheet.getByRole("button", { name: "Add", exact: true }).click();
  const row = sheet.locator(".method-row", {
    has: page.getByLabel("Name of Grandma"),
  });

  await row.getByRole("button", { name: "That's me" }).click();
  await expect(sheet).toContainText("Is this you?");
  await expect(sheet).toContainText("can't be undone");
  await sheet.getByRole("button", { name: "Back" }).click();
  await expect(sheet.getByLabel("Name of Grandma")).toBeVisible();

  // Hardware Back (Escape) on the confirm step goes back one step only.
  await row.getByRole("button", { name: "That's me" }).click();
  await expect(sheet).toContainText("Is this you?");
  await page.keyboard.press("Escape");
  await expect(sheet.getByLabel("Name of Grandma")).toBeVisible();
  await expect(page.locator(".subpage")).toBeVisible();

  await row.getByRole("button", { name: "That's me" }).click();
  await sheet.getByRole("button", { name: "Yes, merge into me" }).click();
  await expect(sheet.getByLabel("Name of Grandma")).toHaveCount(0);
});

test("first run: import a backup from another chat, then merge your old self", async ({
  page,
}) => {
  // A ledger exported from another app instance: different addresses.
  const backup = JSON.stringify({
    settings: { groupCurrency: "EUR", title: "Rome trip" },
    members: {
      "old-anna": {
        id: "old-anna",
        name: "Anna",
        isVirtual: false,
        addr: "old-anna",
      },
      "old-bob": {
        id: "old-bob",
        name: "Bob",
        isVirtual: false,
        addr: "old-bob",
      },
    },
    profiles: { "old-anna": { paypalMe: "anna-old" } },
    expenses: {
      e1: {
        id: "e1",
        title: "Pizza",
        amountCents: 3000,
        payerId: "old-anna",
        split: { mode: "even", entries: { "old-anna": 1, "old-bob": 1 } },
        date: "2026-07-30",
        createdBy: "old-anna",
        editedAt: 1,
      },
    },
  });

  await openAs(page, "Anna");
  await expect(page.getByText("Set up this split")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import a backup instead" }).click();
  await (
    await chooser
  ).setFiles({
    name: "halvsies.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup),
  });

  const prompt = page.locator(".sheet");
  await expect(prompt).toContainText("Were you in this group before?");
  const anna = prompt.locator(".method-row").first();
  await expect(anna.locator("strong")).toHaveText("Anna");
  await anna.getByRole("button", { name: "That's me" }).click();
  await expect(prompt).toContainText("Anna paid for 1 expense, is in 1 split");
  await prompt.getByRole("button", { name: "Yes, merge into me" }).click();

  // Her old payment details are only kept if she says they're hers.
  await expect(prompt).toContainText("Are these your payment details?");
  await expect(prompt).toContainText("anna-old");
  await prompt.getByRole("button", { name: "Yes, they're mine" }).click();

  await expect(prompt).toHaveCount(0);
  await expect(page.locator(".app-header")).toContainText("Rome trip");
  await expect(page.locator(".app-header")).toContainText("2 people");
});

test('"No, I\'m new here" is remembered across reopening the app', async ({
  page,
}) => {
  const backup = JSON.stringify({
    settings: { groupCurrency: "EUR", title: "Rome trip" },
    members: {
      "old-bob": {
        id: "old-bob",
        name: "Bob",
        isVirtual: false,
        addr: "old-bob",
      },
    },
  });
  await openAs(page, "Anna");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import a backup instead" }).click();
  await (
    await chooser
  ).setFiles({
    name: "halvsies.json",
    mimeType: "application/json",
    buffer: Buffer.from(backup),
  });
  const prompt = page.locator(".sheet");
  await expect(prompt).toContainText("Were you in this group before?");
  await prompt.getByRole("button", { name: "No, I'm new here" }).click();
  await expect(prompt).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".app-header")).toContainText("Rome trip");
  await expect(prompt).toHaveCount(0);
});

test("first run: a payment-details file explains itself", async ({ page }) => {
  await openAs(page, "Anna");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import a backup instead" }).click();
  await (
    await chooser
  ).setFiles({
    name: "halvsies-payment-details.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ profile: { paypalMe: "anna" } })),
  });
  await expect(page.getByRole("alert")).toContainText(
    "only holds payment details",
  );
  await expect(page.getByText("Set up this split")).toBeVisible();
});
