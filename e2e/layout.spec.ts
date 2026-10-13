// Every string here is user-supplied (names, titles, IBANs, custom labels), so
// the narrowest phones must never scroll sideways, in either theme.
import { expect, test, type Page } from "@playwright/test";
import {
  addExpense,
  addMethod,
  addVirtualMember,
  methodButtons,
  openAs,
  openNewExpense,
  setUpGroup,
  sheet,
  tab,
} from "./helpers";

const LONG = "Bartholomew-Maximilian Featherstonehaugh-Cholmondeley";

async function expectNoSidewaysScroll(
  page: Page,
  where: string,
): Promise<void> {
  // The page, and every box that scrolls on its own: .app-content, a sheet and
  // a sub-page can each scroll sideways while the page itself stays put.
  const overflow = await page.evaluate(() => {
    const boxes = Array.from(
      document.querySelectorAll<HTMLElement>(".app-content, .sheet, .subpage"),
    );
    return Math.max(
      document.documentElement.scrollWidth - window.innerWidth,
      ...boxes.map((el) => el.scrollWidth - el.clientWidth),
    );
  });
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
    await expect(methodButtons(sheet(page))).toHaveCount(2);
    await expectNoSidewaysScroll(page, "pay-up sheet");
  });
}

test("big figures stay whole on a 360px phone", async ({ page }) => {
  // Rupiah: totals in the tens of millions are ordinary. A figure that wraps
  // mid-number ("12,891,85" / "0.00") reads as a different amount.
  await page.setViewportSize({ width: 360, height: 740 });
  await openAs(page, "Anna");
  await setUpGroup(page, "Bali", "IDR");
  await addVirtualMember(page, "Deniz");
  await addExpense(page, {
    amount: "51695400",
    title: "Villa",
    payer: "Deniz",
  });

  const figures = [".summary-value", ".day-heading .money", ".expense-amount"];
  for (const selector of figures) {
    // A renamed class must fail here, not pass by checking nothing.
    expect(await page.locator(selector).count(), selector).toBeGreaterThan(0);
    for (const el of await page.locator(selector).all()) {
      const lines = await el.evaluate((node) => node.getClientRects().length);
      expect(lines, `${selector} wraps inside a figure`).toBe(1);
    }
  }
  await tab(page, "Balances");
  const heroLines = await page.locator(".hero-amount").evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return range.getClientRects().length;
  });
  expect(heroLines).toBe(1);
  await expect(page.locator(".position-name").first()).toBeVisible();
  await expectNoSidewaysScroll(page, "Balances in IDR");
});

test("keyboard focus is visible on a grouped-list row", async ({ page }) => {
  await openAs(page, "Anna");
  await setUpGroup(page);
  await addExpense(page, { amount: "12", title: "Coffee" });

  const row = page.locator(".list .row", { hasText: "Coffee" });
  // Real keyboard focus (programmatic focus after a tap isn't :focus-visible).
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    if (await row.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(row).toBeFocused();
  // Drawn inside the row and above its neighbours, so the list's rounded
  // clipping can't swallow it.
  const style = await row.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      width: s.outlineWidth,
      offset: s.outlineOffset,
      z: s.zIndex,
      style: s.outlineStyle,
    };
  });
  expect(style.style).not.toBe("none");
  expect(style.offset).toBe("-2px");
  expect(style.z).toBe("2");
});

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

// Only .app-content scrolls. When the page itself was taller than the screen,
// iOS let it scroll and left a blank strip under the tab bar.
test("the page never scrolls vertically, only the list does", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 420 });
  await openAs(page, "Anna");
  await setUpGroup(page, "Trip");
  for (const title of ["Bread", "Cheese", "Wine", "Olives"]) {
    await addExpense(page, { amount: "10", title, payer: "Anna" });
  }
  const m = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".app-content")!;
    const bar = document.querySelector<HTMLElement>(".tab-bar")!;
    return {
      page: document.documentElement.scrollHeight - window.innerHeight,
      list: content.scrollHeight - content.clientHeight,
      barGap: window.innerHeight - bar.getBoundingClientRect().bottom,
    };
  });
  expect(m.page, "page scrolls vertically").toBeLessThanOrEqual(0);
  expect(m.list, "list should overflow in this test").toBeGreaterThan(0);
  expect(m.barGap).toBe(0);

  // Scrolling the list moves only the list: header, add button and tab bar
  // stay put, on the main screen and on a sub-page alike.
  const pinned = (selectors: string[]) =>
    page.evaluate(
      (sels) =>
        sels.map((s) => document.querySelector(s)!.getBoundingClientRect().top),
      selectors,
    );
  const scrollList = (scope: string) =>
    page.evaluate((sc) => {
      const box = document.querySelector<HTMLElement>(`${sc} .app-content`)!;
      box.scrollTop = box.scrollHeight;
      return box.scrollTop;
    }, scope);

  const main = [".app-shell > .app-header", ".fab", ".tab-bar"];
  const before = await pinned(main);
  expect(await scrollList(".app-shell")).toBeGreaterThan(0);
  expect(await pinned(main)).toEqual(before);

  await openNewExpense(page);
  const sub = [".subpage > .app-header"];
  const subBefore = await pinned(sub);
  expect(await scrollList(".subpage")).toBeGreaterThan(0);
  expect(await pinned(sub)).toEqual(subBefore);
});
