// Every string here is user-supplied (names, titles, IBANs, custom labels), so
// the narrowest phones must never scroll sideways, in either theme.
import { expect, test, type Page } from "@playwright/test";
import {
  addExpense,
  addMethod,
  addVirtualMember,
  openAs,
  setUpGroup,
  sheet,
  tab,
} from "./helpers";

const LONG = "Bartholomew-Maximilian Featherstonehaugh-Cholmondeley";

async function expectNoSidewaysScroll(
  page: Page,
  where: string,
): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(
    overflow,
    `${where} scrolls sideways by ${overflow}px`,
  ).toBeLessThanOrEqual(0);
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`nothing scrolls sideways at 320px (${colorScheme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ colorScheme });
    await openAs(page, "Anna");
    await setUpGroup(page, `${LONG}'s birthday weekend in the mountains`);
    await addVirtualMember(page, LONG);
    await addExpense(page, {
      amount: "1234567.89",
      title: `${LONG} booked the entire chalet for everyone`,
      payer: LONG,
    });
    await addMethod(page, "Custom link", {
      Name: `${LONG} pay`,
      "Link template": "https://pay.example/{amount}/{currency}/{ref}",
    });
    await addMethod(page, "Bank transfer", {
      IBAN: "DE89 3704 0044 0532 0130 00",
      "Account holder name": LONG,
    });

    for (const name of ["Expenses", "Balances", "Me"] as const) {
      await tab(page, name);
      await expectNoSidewaysScroll(page, name);
    }

    await page.getByRole("button", { name: "See what payers see" }).click();
    await expect(sheet(page).getByRole("tab")).toHaveCount(2);
    await expectNoSidewaysScroll(page, "pay-up sheet");
  });
}

test("dark mode repaints the page from the dark tokens", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openAs(page, "Anna");
  await setUpGroup(page);

  const luminance = await page.evaluate(() => {
    const [r, g, b] = getComputedStyle(document.body)
      .backgroundColor.match(/\d+/g)!
      .map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  });
  expect(luminance).toBeLessThan(0.15);
});
