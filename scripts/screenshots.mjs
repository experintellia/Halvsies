// Regenerates docs/screenshots/*.png for the README.
//
//   node scripts/screenshots.mjs [--keep]
//
// Drives the real app in headless Chrome over CDP: no browser automation
// dependency (node's global WebSocket is the whole client) and no screenshot
// hooks in src/. The demo ledger is seeded by importing the app's own doc
// module *from inside the page* — the dev server serves /src/state/doc.ts at
// the same URL main.tsx imports it from, so it is the same singleton the
// running app is already rendering.
//
// Chrome comes from the Playwright browser cache if it is there, else from
// $CHROME or a chromium on PATH.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "docs", "screenshots");
const PORT = 3210;
// The mock webxdc reads its identity off the hash, and only calls itself
// "device0" (and injects a dev-tools panel over the bottom-left corner) when
// nothing is passed.
const URL = `http://localhost:${PORT}/#name=Anna&addr=anna@example.org`;

const WIDTH = 390; // iPhone 12/13 logical width — the narrow end of the range
const SCALE = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- chrome ---------------- */

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const cache = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  if (existsSync(cache)) {
    for (const dir of readdirSync(cache).sort().reverse()) {
      for (const rel of [
        ["chrome-headless-shell-linux64", "chrome-headless-shell"],
        ["chrome-linux", "chrome"],
      ]) {
        const bin = join(cache, dir, ...rel);
        if (existsSync(bin)) return bin;
      }
    }
  }
  for (const bin of ["/usr/bin/chromium", "/usr/bin/google-chrome"]) {
    if (existsSync(bin)) return bin;
  }
  throw new Error("no chrome found — set $CHROME to a chromium binary");
}

/* ---------------- CDP over the built-in WebSocket ---------------- */

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error(`cannot reach ${wsUrl}`));
  });

  let nextId = 1;
  const pending = new Map();
  const waiters = [];

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error
        ? reject(new Error(JSON.stringify(msg.error)))
        : resolve(msg.result);
      return;
    }
    for (const w of waiters.splice(0)) {
      w.match(msg) ? w.resolve(msg) : waiters.push(w);
    }
  };

  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });

  const until = (match, ms = 15000) =>
    new Promise((resolve, reject) => {
      const w = { match, resolve };
      waiters.push(w);
      setTimeout(() => {
        const i = waiters.indexOf(w);
        if (i >= 0)
          (waiters.splice(i, 1),
            reject(new Error("timed out waiting for event")));
      }, ms);
    });

  return { send, until, close: () => ws.close() };
}

/* ---------------- the demo ledger ---------------- */

// Real numbers from a real-shaped trip: one person fronts the flat, everyone
// chips in on the rest, and one expense is split by shares because Chloé
// brought her partner. Deniz ends up owed by all three, which is what
// actually happens when one person books.
const SEED = `
const doc = await import("/src/state/doc.ts");
if (doc.listExpenses().length === 0) {
  // newId() mixes in Math.random(), and an avatar's colour is a hash of the
  // member id — so without pinning the sequence every regeneration re-rolls
  // four avatar colours and the whole set of PNGs churns. This seed happens to
  // put the four hues far apart.
  const realRandom = Math.random;
  let s = 108;
  Math.random = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;

  doc.setSettings({ title: "Rome trip", groupCurrency: "EUR" });
  doc.ensureSelfRegistered();
  const me = window.webxdc.selfAddr;
  let t = Date.parse("2026-05-04T09:00:00Z");
  const ben = doc.addVirtualMember("Ben", t++).id;
  const chloe = doc.addVirtualMember("Chloé", t++).id;
  const deniz = doc.addVirtualMember("Deniz", t++).id;

  const all = { [me]: 1, [ben]: 1, [chloe]: 1, [deniz]: 1 };
  const add = (title, amountCents, payerId, entries, date, mode = "even") =>
    doc.addExpense({
      id: String(t++),
      title,
      amountCents,
      payerId,
      split: { mode, entries },
      date,
      createdBy: payerId,
      editedAt: t,
    });

  add("Apartment, 3 nights", 42000, deniz, all, "2026-05-04");
  add("Taxi from the airport", 3200, me, { [me]: 1, [ben]: 1, [chloe]: 2 }, "2026-05-04", "weights");
  add("Wine for the flat", 1860, deniz, all, "2026-05-04");
  add("Groceries", 6340, ben, all, "2026-05-05");
  add("Museum tickets", 4800, chloe, { [me]: 1, [ben]: 1, [chloe]: 1 }, "2026-05-05");
  add("Train to Ostia", 2200, me, all, "2026-05-05");
  add("Dinner at Da Enzo", 9600, ben, all, "2026-05-06");
  add("Gelato, twice", 1440, chloe, all, "2026-05-06");

  // The payee of the biggest debt, so the pay-up sheet has something to show.
  doc.setProfile(deniz, {
    accountHolder: "Deniz Yilmaz",
    iban: "DE89370400440532013000",
    paypalMe: "denizy",
    bunqMe: "deniz",
    note: "IBAN is easiest for me — PayPal charges a fee on the receiving end.",
  });
  doc.setProfile(me, {
    accountHolder: "Anna Beispiel",
    iban: "DE21301204000000015228",
    paypalMe: "annab",
    revolutTag: "annab",
    note: "Away until the 20th — no rush, bank transfer whenever.",
  });

  Math.random = realRandom;
}
`;

/* ---------------- driving the UI ---------------- */

// Taps ride pointerup in Delta Chat's WebView (see Row.tsx), so they do here.
const HELPERS = `
const tap = (el) => {
  if (!el) throw new Error("nothing to tap");
  el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
};
const byText = (sel, text) =>
  [...document.querySelectorAll(sel)].find((e) => (e.textContent || "").includes(text));
const tab = (name) => tap(byText(".tab-btn", name));
const esc = () => {
  const close = document.querySelector(".sheet-close, .subpage-back");
  if (close) tap(close);
};
`;

// One step per tap, each its own Runtime.evaluate with a settle in between:
// a tap has to re-render before the next selector can find what it produced,
// and waiting node-side keeps every in-page expression synchronous.
const SHOTS = [
  {
    name: "expenses",
    caption: "Every expense, newest first",
    steps: [`esc(); tab("Expenses"); window.scrollTo(0, 0)`],
  },
  {
    name: "balances",
    caption: "Who owes whom, in as few transfers as possible",
    steps: [`esc(); tab("Balances")`],
  },
  {
    name: "payup",
    caption: "One tap from a debt to actually paying it",
    height: 1180,
    // "You owe …", not "Deniz" — the first .row mentioning Deniz is his
    // net-position card, which is static by design.
    steps: [`esc(); tab("Balances")`, `tap(byText(".row", "You owe"))`],
  },
  {
    name: "expense",
    caption: "Tap an expense for a read-only summary; edit is a deliberate tap",
    steps: [`esc(); tab("Expenses")`, `tap(byText(".row", "Taxi"))`],
  },
  {
    name: "shares",
    caption: "Split evenly, by shares, or by exact amounts",
    height: 1180,
    steps: [
      `esc(); tab("Expenses")`,
      `tap(byText(".row", "Taxi"))`,
      `tap(byText("button", "Edit"))`,
    ],
  },
  {
    name: "me",
    caption: "Your payment details, exactly as the payer will see them",
    height: 1180,
    steps: [`esc(); tab("Me"); window.scrollTo(0, 0)`],
  },
];

/* ---------------- run ---------------- */

async function waitForServer(url, ms = 30000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error(`dev server never came up on ${url}`);
}

const keep = process.argv.includes("--keep");
const profile = mkdtempSync(join(tmpdir(), "halvsies-shots-"));
const children = [];
const kill = () => {
  for (const c of children) c.kill();
  if (!keep) rmSync(profile, { recursive: true, force: true });
};
process.on("exit", kill);
process.on("SIGINT", () => (kill(), process.exit(1)));

// Its own port and its own chrome profile: whatever `pnpm test:peers` has on
// :3000, and whatever localStorage the mock host accumulated there, stays out
// of the pictures.
const vite = spawn(
  join(ROOT, "node_modules", ".bin", "vite"),
  ["--port", String(PORT), "--strictPort"],
  { cwd: ROOT, stdio: "ignore" },
);
children.push(vite);
await waitForServer(`http://localhost:${PORT}/`);

const chrome = spawn(findChrome(), [
  "--remote-debugging-port=0",
  `--user-data-dir=${profile}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--hide-scrollbars",
  "about:blank",
]);
children.push(chrome);

const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/ws:\/\/\S+/);
    if (m) resolve(m[0]);
  });
  chrome.on("exit", (code) =>
    reject(new Error(`chrome exited (${code}): ${buf}`)),
  );
});

const cdp = await connect(wsUrl);
const { targetId } = await cdp.send("Target.createTarget", {
  url: "about:blank",
});
const { sessionId } = await cdp.send("Target.attachToTarget", {
  targetId,
  flatten: true,
});

const evaluate = (body, { async: isAsync = false } = {}) =>
  cdp
    .send(
      "Runtime.evaluate",
      {
        expression: isAsync
          ? `(async () => { ${body} })()`
          : `(() => { ${body} })()`,
        awaitPromise: isAsync,
        returnByValue: true,
      },
      sessionId,
    )
    .then((r) => {
      if (r.exceptionDetails) {
        throw new Error(
          r.exceptionDetails.exception?.description ?? "page threw",
        );
      }
      return r.result?.value;
    });

const setViewport = (height) =>
  cdp.send(
    "Emulation.setDeviceMetricsOverride",
    { width: WIDTH, height, deviceScaleFactor: SCALE, mobile: true },
    sessionId,
  );

await cdp.send("Page.enable", {}, sessionId);
await setViewport(844);
await cdp.send("Page.navigate", { url: URL }, sessionId);
await cdp.until(
  (m) => m.method === "Page.loadEventFired" && m.sessionId === sessionId,
);
await evaluate(SEED, { async: true });
await sleep(400); // the doc write lands through a subscription, not synchronously

mkdirSync(OUT, { recursive: true });
for (const shot of SHOTS) {
  await setViewport(shot.height ?? 844);
  for (const step of shot.steps) {
    await evaluate(HELPERS + step);
    await sleep(250);
  }
  await sleep(200);
  const { data } = await cdp.send(
    "Page.captureScreenshot",
    { format: "png" },
    sessionId,
  );
  const file = join(OUT, `${shot.name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  console.log(`${shot.name}.png — ${shot.caption}`);
}

cdp.close();
kill();
process.exit(0);
