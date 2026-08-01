#!/usr/bin/env node
// Build gate for the "Webxdc sandbox (non-negotiable)" rules in CLAUDE.md.
//
// These used to be MANUAL.md items F1/F2, checked by hand with `du -h` and a
// couple of greps. They fail silently and late: a stray fetch() or CDN <link>
// only breaks inside a messenger, where there is no console to look at. So
// `pnpm build` runs this and refuses to hand you a broken .xdc.
//
// Scope: `dist/` is the audited tree — buildXDC() zips exactly that into
// `dist-xdc/halvsies.xdc`, so auditing dist/ audits the artifact, minus the
// zip container itself (which is checked separately for its entry names).
//
// Node stdlib only, no dependencies. Run from anywhere; paths are resolved
// relative to this file.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const XDC = join(ROOT, "dist-xdc", "halvsies.xdc");

const SIZE_BUDGET = 1024 * 1024; // 1 MiB, per CLAUDE.md

/**
 * lib0 (a Yjs dependency) probes for localStorage behind a `typeof` guard and
 * falls back to an in-memory Map. That is the ONLY localStorage in the bundle,
 * and it is three tokens of one expression. Asserting the exact count catches a
 * new dependency — or our own code — reaching for it, which zero-tolerance
 * cannot do without vendoring a patched lib0.
 */
const LOCALSTORAGE_EXPECTED = 3;
const LOCALSTORAGE_OWNER =
  "lib0 (yjs dep) — guarded probe with in-memory fallback";

/**
 * Hosts allowed to appear as literal `https?://…` text in the bundle.
 *
 * THE RULE, and why it is not just "no http in the bundle": this app's whole
 * job includes handing the user a payment deep link, so `src/pay/links.ts`
 * builds `https://paypal.me/…`, `https://bunq.me/…` and friends as strings.
 * Those literals are in the bundle and always will be. What must never be in
 * the bundle is a *reference the browser would resolve* — a <script src>, a
 * <link href>, a CSS url()/@import, a dynamic import() of a URL. So:
 *
 *   1. Structural references (HTML attributes, CSS url()/@import) are checked
 *      separately and may never be remote at all — no allow-list, no exceptions.
 *   2. Bare string literals are checked against this host allow-list, which is
 *      *derived from src/pay/links.ts itself* rather than typed out here, so
 *      adding a payment method cannot make this check wrong, and adding a CDN
 *      cannot make it pass.
 *
 * Extras beyond the payment origins:
 *   - www.w3.org: XML namespace URIs emitted by Preact for SVG/MathML. They are
 *     identifiers, never fetched.
 *   - RESERVED_TLDS: RFC 2606/6761 names that cannot resolve, ever. Used by the
 *     custom-template placeholder ("https://pay.example/{amount}/…").
 *   - ALLOWED_URLS: exact URLs, for dependency error messages that print a link.
 */
const EXTRA_HOSTS = ["www.w3.org"];
const RESERVED_TLDS = ["example", "invalid", "test", "localhost"];
const ALLOWED_URLS = [
  "https://github.com/yjs/yjs/issues/438", // yjs prints this in an error message
];

/** Network APIs. Minifiers rename locals but never global built-ins, so these survive. */
const NETWORK_PATTERNS = [
  [/\bfetch\s*\(/, "fetch("],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bsendBeacon\b/, "navigator.sendBeacon"],
  [/\bimport\s*\(\s*["'`]\s*(?:https?:)?\/\//, "import() of a remote URL"],
];

/**
 * Syntax the declared floor (es2020 / chrome87 / safari14.1 / firefox78) cannot
 * parse. This is a smoke check, not a parser: it is a substring scan over
 * minified output, so it catches the shapes esbuild would have had to downlevel
 * and nothing more. Top-level await is handled below with a real parse instead.
 */
const SYNTAX_PATTERNS = [
  [/\?\?=/, "??= (logical assignment, ES2021)"],
  [/\|\|=/, "||= (logical assignment, ES2021)"],
  [/&&=/, "&&= (logical assignment, ES2021)"],
  [/\.at\s*\(/, ".at() (ES2022)"],
  [/\bstructuredClone\b/, "structuredClone (not in the target floor)"],
];

const failures = [];
const fail = (check, message) => failures.push(`${check}: ${message}`);

/** "…40 chars… MATCH …40 chars…", newlines flattened, for a readable message. */
function context(text, index, length) {
  const slice = text.slice(Math.max(0, index - 40), index + length + 40);
  return slice.replace(/\s+/g, " ").trim();
}

function where(text, index) {
  const before = text.slice(0, index);
  const line = before.split("\n").length;
  const col = index - before.lastIndexOf("\n");
  return `${line}:${col}`;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// --- 0. the build must exist ------------------------------------------------

if (!statSync(DIST, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(
    `audit-bundle: no build to audit — ${relative(ROOT, DIST)}/ is missing. Run \`vite build\` first.`,
  );
  process.exit(2);
}

const files = walk(DIST);
const textFiles = files.filter((f) =>
  /\.(js|mjs|css|html|json|toml|svg)$/i.test(f),
);
const sources = textFiles.map((f) => ({
  path: relative(ROOT, f),
  text: readFileSync(f, "utf8"),
}));
const jsCss = sources.filter((s) => /\.(js|mjs|css)$/i.test(s.path));

// --- 1. size budget ---------------------------------------------------------

const xdcStat = statSync(XDC, { throwIfNoEntry: false });
if (!xdcStat) {
  fail("size", `${relative(ROOT, XDC)} was not produced by the build.`);
} else {
  const pct = (xdcStat.size / SIZE_BUDGET) * 100;
  // Printed on every build, not just on failure: a budget you only see when it
  // breaks is a budget nobody notices creeping.
  console.log(
    `audit-bundle: halvsies.xdc ${xdcStat.size.toLocaleString("en-US")} B — ${pct.toFixed(1)}% of the ${SIZE_BUDGET.toLocaleString("en-US")} B (1 MiB) budget`,
  );
  if (xdcStat.size >= SIZE_BUDGET) {
    fail(
      "size",
      `halvsies.xdc is ${xdcStat.size.toLocaleString("en-US")} B — ${pct.toFixed(1)}% of the 1 MiB budget. Webxdc bundles must stay under 1 MiB (CLAUDE.md). Find the weight with: unzip -l dist-xdc/halvsies.xdc`,
    );
  }
}

// --- 2. no network APIs -----------------------------------------------------

for (const { path, text } of jsCss) {
  for (const [re, label] of NETWORK_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      fail(
        "no-network",
        `${path}:${where(text, m.index)} contains \`${label}\` — the webxdc sandbox has no network at runtime.\n    …${context(text, m.index, m[0].length)}…`,
      );
    }
  }
}

// --- 3. no external URLs ----------------------------------------------------

// 3a. structural references: absolutely no remote targets, allow-list or not.
const structural = [
  [
    /<(?:script|link|img|iframe|source|audio|video)\b[^>]*\b(?:src|href)\s*=\s*["']?((?:https?:)?\/\/[^"'\s>]+)/gi,
    "HTML element loading a remote URL",
  ],
  [
    /url\(\s*["']?\s*((?:https?:)?\/\/[^)"']+)/gi,
    "CSS url() pointing off-bundle",
  ],
  [
    /@import\s+(?:url\(\s*)?["']?\s*((?:https?:)?\/\/[^;)"']+)/gi,
    "CSS @import pointing off-bundle",
  ],
];
for (const { path, text } of sources) {
  for (const [re, label] of structural) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      fail(
        "no-external-url",
        `${path}:${where(text, m.index)} — ${label}: ${m[1]}\n    Everything a webxdc app loads must ship inside the .xdc.`,
      );
    }
  }
}

// 3b. string literals: host allow-list derived from src/pay/links.ts.
const linksSrc = readFileSync(join(ROOT, "src", "pay", "links.ts"), "utf8");
const hostOf = (url) => {
  const host = url.slice(url.indexOf("//") + 2).split(/[/?#$:\\]/)[0];
  // Not hostname-shaped (needs at least one dot label) => not a URL a browser
  // could resolve. This deliberately skips things like the literal "https://"
  // inside the validation message in links.ts, and `https://${runtimeVar}/…`,
  // whose host is not statically knowable anyway.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(
    host,
  )
    ? host.toLowerCase()
    : null;
};
const URL_RE = /https?:\/\/[^\s"'`)\\]*/g;
const payHosts = new Set(
  [...linksSrc.matchAll(URL_RE)].map((m) => hostOf(m[0])).filter(Boolean),
);
if (payHosts.size === 0) {
  fail(
    "no-external-url",
    "could not derive any payment host from src/pay/links.ts — the allow-list would be empty, refusing to run a check that cannot fail correctly.",
  );
}
const allowedHosts = new Set([...payHosts, ...EXTRA_HOSTS]);

for (const { path, text } of jsCss) {
  URL_RE.lastIndex = 0;
  let m;
  while ((m = URL_RE.exec(text))) {
    if (ALLOWED_URLS.some((u) => m[0].startsWith(u))) continue;
    const host = hostOf(m[0]);
    if (!host) continue;
    if (allowedHosts.has(host)) continue;
    if (RESERVED_TLDS.includes(host.split(".").pop())) continue;
    fail(
      "no-external-url",
      `${path}:${where(text, m.index)} — unexpected external URL host \`${host}\`: ${m[0]}\n    Allowed hosts come from src/pay/links.ts (${[...payHosts].sort().join(", ")}) plus ${EXTRA_HOSTS.join(", ")}.\n    If this is a new payment provider, add it in src/pay/links.ts and it is allowed automatically. If it is a CDN or an asset, vendor it into the bundle instead.`,
    );
  }
}

// --- 4. webxdc.js referenced, never bundled ---------------------------------

const html = sources.find(
  (s) => s.path === relative(ROOT, join(DIST, "index.html")),
);
if (!html) {
  fail("webxdc-shim", "dist/index.html is missing.");
} else if (!/<script[^>]*\bsrc\s*=\s*["']webxdc\.js["']/i.test(html.text)) {
  fail(
    "webxdc-shim",
    `dist/index.html does not reference <script src="webxdc.js"> — the messenger injects that file at runtime and the app cannot talk to the chat without it.`,
  );
}
for (const f of files) {
  if (/(^|[/\\])webxdc\.js$/i.test(f)) {
    fail(
      "webxdc-shim",
      `${relative(ROOT, f)} — webxdc.js must NOT be shipped in the bundle; the messenger provides it. (This is likely the dev-only mockWebxdc() shim leaking into a production build.)`,
    );
  }
}
for (const { path, text } of jsCss) {
  const m = /\b(?:window|globalThis|self)\s*\.\s*webxdc\s*=[^=]/.exec(text);
  if (m) {
    fail(
      "webxdc-shim",
      `${path}:${where(text, m.index)} assigns to window.webxdc — a webxdc shim/mock is bundled, which would shadow the real messenger API.\n    …${context(text, m.index, m[0].length)}…`,
    );
  }
}

// --- 5. no localStorage in our code -----------------------------------------

const srcHits = walk(join(ROOT, "src"))
  .filter((f) => /\.(ts|tsx|js|jsx|css)$/i.test(f))
  .flatMap((f) =>
    readFileSync(f, "utf8").includes("localStorage") ? [relative(ROOT, f)] : [],
  );
if (srcHits.length) {
  fail(
    "no-localstorage",
    `localStorage used in our own source: ${srcHits.join(", ")}. Durable state goes through the Y.Doc only (CLAUDE.md).`,
  );
}

const lsCount = jsCss.reduce(
  (n, s) => n + (s.text.match(/\blocalStorage\b/g)?.length ?? 0),
  0,
);
if (lsCount !== LOCALSTORAGE_EXPECTED) {
  fail(
    "no-localstorage",
    `expected exactly ${LOCALSTORAGE_EXPECTED} localStorage references in the bundle, found ${lsCount}.\n    The known ${LOCALSTORAGE_EXPECTED} are ${LOCALSTORAGE_OWNER}.\n    If a dependency upgrade legitimately changed this: confirm the new hits are all inside a \`typeof localStorage\` guard with a non-persistent fallback (grep the bundle for localStorage and read the surrounding expression), then update LOCALSTORAGE_EXPECTED and LOCALSTORAGE_OWNER in this script. If any hit is ours, remove it — durable state goes through the Y.Doc.`,
  );
}

// --- 6. browser-target floor ------------------------------------------------

for (const { path, text } of jsCss) {
  for (const [re, label] of SYNTAX_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      fail(
        "target-floor",
        `${path}:${where(text, m.index)} contains ${label} — the build target floor is es2020/chrome87/safari14.1/firefox78 (vite.config.ts) and older engines cannot parse or run it.\n    …${context(text, m.index, m[0].length)}…`,
      );
    }
  }
}

// Top-level await, for real rather than by regex: the emitted chunk has no
// import/export statements, so Node can parse it as a plain script — and a
// plain script rejects top-level await. Any other parse error means the output
// format changed (e.g. code-splitting), which is not this check's business.
for (const { path, text } of jsCss.filter((s) => s.path.endsWith(".js"))) {
  try {
    new Function(text);
  } catch (err) {
    if (/await/i.test(err.message)) {
      fail(
        "target-floor",
        `${path} uses top-level await, which the es2020 target cannot emit: ${err.message}`,
      );
    }
  }
}

// --- report -----------------------------------------------------------------

if (failures.length) {
  console.error(
    `\naudit-bundle: FAILED — ${failures.length} violation(s) of the webxdc sandbox rules (CLAUDE.md):\n`,
  );
  for (const f of failures) console.error(`  ✗ ${f}\n`);
  process.exit(1);
}

console.log(
  `audit-bundle: OK — ${sources.length} text assets scanned; no network APIs, no external URLs, webxdc.js referenced not bundled, localStorage ${lsCount}/${LOCALSTORAGE_EXPECTED} (${LOCALSTORAGE_OWNER}), target floor clean.`,
);
