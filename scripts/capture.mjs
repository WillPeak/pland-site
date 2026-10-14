import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const playwright = await import(process.env.PLAYWRIGHT_PATH || "playwright");
const chromium = playwright.chromium || playwright.default.chromium;

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "artifacts");
const port = 4173;
const base = `http://127.0.0.1:${port}`;

fs.mkdirSync(outDir, { recursive: true });

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (!html.includes('action="https://api.pland.ai/waitlist"')) {
  console.error("form does not post to the waitlist API");
  process.exit(1);
}
if (html.includes('action="mailto:')) {
  console.error("form action is still mailto");
  process.exit(1);
}
if (html.includes("fetch(")) {
  console.error("inline fetch on the homepage");
  process.exit(1);
}

const csp = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.pland.ai; form-action 'self' mailto: https://api.pland.ai; base-uri 'self'; object-src 'none'; frame-ancestors 'none'";
const pageFiles = ["index.html", "privacy/index.html", "plaid/redirect/index.html"];
const pageText = pageFiles.map((rel) => fs.readFileSync(path.join(root, rel), "utf8")).join("\n");
for (const rel of pageFiles) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  if (!text.includes(csp)) {
    console.error("csp missing " + rel);
    process.exit(1);
  }
  if (!text.includes('name="referrer" content="strict-origin-when-cross-origin"')) {
    console.error("referrer missing " + rel);
    process.exit(1);
  }
  if (/<style[\s>]|style=|fonts\.google|fonts\.gstatic|<iframe|googletagmanager|gtag\(|plausible/i.test(text)) {
    console.error("third party or inline style " + rel);
    process.exit(1);
  }
  if (/<script(?![^>]*\ssrc=)/i.test(text)) {
    console.error("inline script " + rel);
    process.exit(1);
  }
}
if (/\bMini\b/.test(pageText)) {
  console.error("page mentions Mini");
  process.exit(1);
}
for (const raw of pageText.match(/https?:\/\/[^"'()\s]+/g) || []) {
  const url = raw.replace(/[;,]+$/g, "");
  const host = new URL(url).host;
  if (host !== "pland.ai" && host !== "api.pland.ai") {
    console.error("unexpected host " + url);
    process.exit(1);
  }
}
for (const rel of ["plaid/redirect.js", "site.css"]) {
  const text = fs.readFileSync(path.join(root, rel), "utf8");
  if (/https?:\/\/|fetch\(|XMLHttpRequest|gtag\(/i.test(text)) {
    console.error("external call in " + rel);
    process.exit(1);
  }
}
const waitlistJs = fs.readFileSync(path.join(root, "waitlist.js"), "utf8");
const waitlistUrls = waitlistJs.match(/https?:\/\/[^"'\\\s)]+/g) || [];
if (waitlistUrls.length !== 1 || waitlistUrls[0] !== "https://api.pland.ai/waitlist") {
  console.error("waitlist urls " + waitlistUrls.join(","));
  process.exit(1);
}
if (!waitlistJs.includes("fetch(")) {
  console.error("waitlist does not fetch");
  process.exit(1);
}
if (/XMLHttpRequest|gtag\(|mailto:/i.test(waitlistJs)) {
  console.error("unexpected call in waitlist.js");
  process.exit(1);
}

const child = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
  cwd: root,
  env: { ...process.env, PYTHONUNBUFFERED: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

function fail(message) {
  console.error(message);
  child.kill();
  process.exit(1);
}

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server did not start")), 8000);
  const probe = async () => {
    try {
      const res = await fetch(base + "/");
      if (res.ok) {
        clearTimeout(timer);
        resolve();
        return;
      }
    } catch {
      /* not up yet */
    }
    setTimeout(probe, 100);
  };
  child.on("exit", (code) => reject(new Error("server exited " + code)));
  probe();
});

const launchOptions = {};
if (process.env.CHROME_PATH) {
  launchOptions.executablePath = process.env.CHROME_PATH;
  launchOptions.args = ["--no-sandbox", "--disable-dev-shm-usage"];
}
if (process.env.HEADED) launchOptions.headless = false;
const browser = await chromium.launch(launchOptions);
const page = await browser.newPage();
await page.emulateMedia({ reducedMotion: "reduce" });
const requests = [];
const cspViolations = [];
page.on("request", (req) => requests.push(req.method() + " " + req.url()));
page.on("console", (msg) => {
  const text = msg.text();
  if (/frame-ancestors/i.test(text)) {
    console.log("csp note", text);
    return;
  }
  if (/Content Security Policy|Refused to/i.test(text)) cspViolations.push(text);
});

async function settle() {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

async function assertFold(width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await settle();
  const cta = await page.locator("#hero-cta").boundingBox();
  const shot = await page.locator(".hero-shot").boundingBox();
  const waitlist = await page.locator("#waitlist").boundingBox();
  const summary = await page.locator("#how summary").boundingBox();
  console.log("fold", JSON.stringify({ width, height, cta, shot, waitlist, summary }));
  if (!cta || !shot || !waitlist || !summary) fail("missing hero box " + width);
  if (cta.y + cta.height > height + 1) fail("CTA below the fold at " + width);
  if (shot.y + shot.height > height + 1) fail("visual below the fold at " + width);
  if (waitlist.y < height - 2) fail("waitlist peeks into the first screen at " + width);
  if (summary.y < height - 2) fail("See how it works peeks into the first screen at " + width);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (wide) fail("horizontal overflow at " + width);
  const h1 = await page.locator("h1").innerText();
  if (h1 !== "Healthier, wealthier, happier.") fail("unexpected h1");
  const hero = await page.locator(".hero-copy").innerText();
  if (!hero.includes("You approve; over time, it runs itself.")) fail("hero line missing at " + width);
  if (/Hands-free is how it grows|available today|live now/i.test(hero)) fail("old hero line at " + width);
  const fonts = await page.evaluate(() => [...document.fonts].map((face) => face.family + " " + face.status));
  if (!fonts.some((face) => face.startsWith("Nunito Sans") && face.endsWith("loaded"))) fail("Nunito Sans did not load at " + width + " " + fonts.join(","));
}

await assertFold(390, 844);
await page.screenshot({ path: path.join(outDir, "hero-390x844.png") });
await assertFold(1440, 900);
await page.screenshot({ path: path.join(outDir, "hero-1440x900.png") });

async function expanded(width, name) {
  await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await settle();
  await page.locator("#how").evaluate((el) => { el.open = true; });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (wide) fail("horizontal overflow expanded " + width);
  const text = await page.locator("#how").innerText();
  const visible = text.toLowerCase();
  for (const needle of [
    "books through a partner",
    "secret gift on a single-use card",
    "talk",
    "imessage",
    "flyer",
    "wallet",
    "retirement odds",
    "under-13",
    "connected wearable",
    "in beta, rolling out to waitlist households first",
    "you start by approving or swapping",
    "hands-free is where it's heading",
  ]) {
    if (!visible.includes(needle)) fail("missing expanded copy: " + needle);
  }
  const pageText = text + await page.content();
  if (/Instinct|Apple Health|silent auto-booking|\/api\/waitlist|class="next"|The rest of the week doesn't|one bad call|sends it back to drafting|available today|live now/i.test(pageText)) {
    fail("forbidden expanded copy");
  }
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
}
await expanded(390, "homepage-expanded-390.png");
await expanded(1440, "homepage-expanded-1440.png");

async function privacy(width, name) {
  await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
  const response = await page.goto(base + "/privacy", { waitUntil: "networkidle" });
  if (!page.url().endsWith("/privacy/")) fail("privacy redirect missing, url " + page.url());
  if (!response || response.status() >= 400) fail("privacy status");
  await settle();
  const text = await page.locator("main").innerText();
  if (!text.includes("This site is published by Pland.")) fail("publisher missing");
  if (!text.includes("hello@pland.ai")) fail("privacy contact missing");
  const braces = String.fromCharCode(123, 123);
  if (text.includes(braces) || /LEGAL_ENTITY|GOVERNING_LAW|Unfilled, on purpose|Governing law/i.test(text)) fail("privacy placeholder still present");
  if (/waitlist service|private file/i.test(text)) fail("privacy still describes the unhosted store");
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
}
await privacy(390, "privacy-390.png");
await privacy(1440, "privacy-1440.png");

const waitlistCalls = [];
let waitlistMode = "ok";
await page.route("https://api.pland.ai/waitlist", async (route) => {
  const request = route.request();
  const origin = request.headers().origin || `http://127.0.0.1:${port}`;
  const headers = {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "content-type": "application/json",
  };
  if (request.method() === "OPTIONS") {
    await route.fulfill({ status: 204, headers, body: "" });
    return;
  }
  waitlistCalls.push({ method: request.method(), body: request.postData() || "", headers: request.headers() });
  const mode = waitlistMode;
  if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 800));
  if (mode === "rate") {
    await route.fulfill({ status: 429, headers, body: '{"ok":false,"error":"rate_limited"}' });
    return;
  }
  if (mode === "invalid-email") {
    await route.fulfill({ status: 400, headers, body: '{"ok":false,"error":"invalid_email"}' });
    return;
  }
  if (mode === "invalid-name") {
    await route.fulfill({ status: 400, headers, body: '{"ok":false,"error":"invalid_name"}' });
    return;
  }
  if (mode === "down") {
    await route.abort("failed");
    return;
  }
  if (mode === "ok" || mode === "slow") {
    await route.fulfill({ status: 200, headers, body: '{"ok":true}' });
    return;
  }
  await route.fulfill({ status: 500, headers, body: '{"ok":false,"error":"internal"}' });
});

function rawCode(text) {
  return /invalid_|rate_limited|origin_not_allowed|payload_too_large|\b429\b|\b400\b|\b403\b|\b500\b|\{"ok"/.test(text);
}

async function fillWaitlist() {
  await page.fill("#name", "Sample Household");
  await page.fill("#email", "sample.household@example.com");
  await page.selectOption("#household", "2 adults");
  await page.selectOption("#ios", "Mostly iOS");
}

async function formShot(name) {
  await page.locator("#waitlist").scrollIntoViewIfNeeded();
  await page.locator("#waitlist").screenshot({ path: path.join(outDir, name) });
}

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(base + "/", { waitUntil: "networkidle" });
await settle();
const action = await page.locator("#waitlist-form").getAttribute("action");
if (action !== "https://api.pland.ai/waitlist") fail("form action " + action);
const fine = await page.locator("#waitlist .fine").innerText();
if (!fine.includes("hello@pland.ai")) fail("fallback address missing");

const beforeEmpty = waitlistCalls.length;
await page.click("#waitlist-submit");
await page.waitForSelector("#waitlist-status.err");
const emptyText = await page.locator("#waitlist-status").innerText();
if (emptyText !== "Add your name, email, household, and whether you use iPhones.") fail("empty copy " + emptyText);
if (waitlistCalls.length !== beforeEmpty) fail("empty submit posted");
if (await page.locator("#waitlist-submit").isDisabled()) fail("button stayed disabled after validation");

await page.fill("#name", "Sample Household");
await page.fill("#email", "not-an-email");
await page.selectOption("#household", "2 adults");
await page.selectOption("#ios", "Yes — we use iPhones");
const beforeBad = waitlistCalls.length;
await page.click("#waitlist-submit");
await page.waitForSelector("#waitlist-status.err");
const badEmail = await page.locator("#waitlist-status").innerText();
if (badEmail !== "That email doesn't look right. Check it and try again.") fail("email copy " + badEmail);
if (waitlistCalls.length !== beforeBad) fail("invalid email posted");
if (rawCode(badEmail)) fail("raw code in email copy");
const invalidFlag = await page.locator("#email").getAttribute("aria-invalid");
if (invalidFlag !== "true") fail("email aria-invalid");
const errColor = await page.evaluate(() => getComputedStyle(document.querySelector("#waitlist-status")).color);
if (errColor !== "rgb(255, 180, 171)") fail("error color " + errColor);
await page.emulateMedia({ colorScheme: "light" });
const lightErr = await page.evaluate(() => getComputedStyle(document.querySelector("#waitlist-status")).color);
await page.emulateMedia({ colorScheme: "dark" });
const darkErr = await page.evaluate(() => getComputedStyle(document.querySelector("#waitlist-status")).color);
if (lightErr !== darkErr || lightErr !== errColor) fail("error color changed with color scheme " + lightErr + " " + darkErr);
await formShot("waitlist-error-1440.png");

waitlistMode = "slow";
await fillWaitlist();
const sendPromise = page.click("#waitlist-submit");
await page.waitForFunction(() => {
  const button = document.querySelector("#waitlist-submit");
  return button && button.disabled && button.textContent === "Joining…";
});
await sendPromise;
await page.waitForSelector("#waitlist-status.ok");
const successText = await page.locator("#waitlist-status").innerText();
if (successText !== "You're on the list. We'll write with TestFlight details.") fail("success copy " + successText);
if (await page.locator("#waitlist-form").isVisible()) fail("form still visible after success");
if (!waitlistCalls.length) fail("success did not post");
const posted = waitlistCalls[waitlistCalls.length - 1];
if (posted.method !== "POST") fail("method " + posted.method);
const payload = JSON.parse(posted.body);
const keys = Object.keys(payload).sort().join(",");
if (keys !== "email,household,ios,name") fail("payload keys " + keys);
if (payload.name !== "Sample Household") fail("payload name");
if (payload.email !== "sample.household@example.com") fail("payload email");
if (payload.household !== "2 adults") fail("payload household");
if (payload.ios !== "Mostly iOS") fail("payload ios");
const contentType = posted.headers["content-type"] || "";
if (!contentType.includes("application/json")) fail("content-type " + contentType);
await formShot("waitlist-success-1440.png");

async function failedMode(mode, expected) {
  waitlistCalls.length = 0;
  waitlistMode = mode;
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await settle();
  await fillWaitlist();
  await page.click("#waitlist-submit");
  await page.waitForSelector("#waitlist-status.err");
  const text = await page.locator("#waitlist-status").innerText();
  if (text !== expected) fail(mode + " copy " + text);
  if (rawCode(text)) fail(mode + " showed a raw code");
  if (!text.includes("hello@pland.ai")) fail(mode + " missing fallback");
  if (await page.locator("#waitlist-submit").isDisabled()) fail(mode + " left the button disabled");
  if ((await page.locator("#waitlist-submit").innerText()) !== "Join the waitlist") fail(mode + " button label");
  return text;
}
await failedMode("rate", "That's a few too many tries. Wait a little, or email hello@pland.ai.");
await formShot("waitlist-rate-limit-1440.png");
await failedMode("invalid-email", "That email doesn't look right. Check it and try again, or email hello@pland.ai.");
await failedMode("invalid-name", "Check your name, household, and whether you use iPhones, or email hello@pland.ai.");
await failedMode("down", "That didn't save. Try again in a moment, or email hello@pland.ai.");
await failedMode("other", "That didn't save. Try again in a moment, or email hello@pland.ai.");
console.log("waitlist states ok");

await page.setViewportSize({ width: 390, height: 844 });
waitlistMode = "ok";
await page.goto(base + "/", { waitUntil: "networkidle" });
await settle();
await page.fill("#name", "Sample Household");
await page.fill("#email", "not-an-email");
await page.selectOption("#household", "2 adults + kids");
await page.selectOption("#ios", "No / mixed");
await page.click("#waitlist-submit");
await page.waitForSelector("#waitlist-status.err");
await formShot("waitlist-error-390.png");
await page.fill("#name", "Sample Household");
await page.fill("#email", "sample.household@example.com");
await page.selectOption("#household", "2 adults + kids");
await page.selectOption("#ios", "Yes — we use iPhones");
await page.click("#waitlist-submit");
await page.waitForSelector("#waitlist-status.ok");
const mobilePayload = JSON.parse(waitlistCalls[waitlistCalls.length - 1].body);
if (mobilePayload.household !== "2 adults + kids") fail("mobile household");
if (mobilePayload.ios !== "Yes — we use iPhones") fail("mobile ios " + mobilePayload.ios);
await formShot("waitlist-success-390.png");

await page.emulateMedia({ colorScheme: "light" });
const lightStatus = await page.evaluate(() => {
  const node = document.querySelector("#waitlist-status");
  return {
    bg: getComputedStyle(document.body).backgroundColor,
    card: getComputedStyle(document.querySelector(".form-card")).backgroundColor,
    status: node ? getComputedStyle(node).color : "",
  };
});
await page.emulateMedia({ colorScheme: "dark" });
const darkStatus = await page.evaluate(() => {
  const node = document.querySelector("#waitlist-status");
  return {
    bg: getComputedStyle(document.body).backgroundColor,
    card: getComputedStyle(document.querySelector(".form-card")).backgroundColor,
    status: node ? getComputedStyle(node).color : "",
  };
});
console.log("form colors", JSON.stringify({ lightStatus, darkStatus }));
if (lightStatus.bg !== darkStatus.bg || lightStatus.card !== darkStatus.card || lightStatus.status !== darkStatus.status) {
  fail("form status changed with prefers-color-scheme");
}

const metas = await page.evaluate(() => {
  const pick = (sel) => document.querySelector(sel)?.getAttribute("content") || "";
  return {
    title: document.title,
    description: pick('meta[name="description"]'),
    ogDescription: pick('meta[property="og:description"]'),
    ogImage: pick('meta[property="og:image"]'),
    ogWidth: pick('meta[property="og:image:width"]'),
    ogHeight: pick('meta[property="og:image:height"]'),
    card: pick('meta[name="twitter:card"]'),
    twitterDescription: pick('meta[name="twitter:description"]'),
  };
});
console.log("meta", JSON.stringify(metas, null, 2));
if (!metas.title.trim()) fail("empty title");
if (metas.card !== "summary_large_image") fail("twitter card");
if (!metas.ogImage.endsWith("/og.png")) fail("og image url");
for (const value of [metas.description, metas.ogDescription, metas.twitterDescription]) {
  if (/sleep, money, and time/i.test(value)) fail("old description still present");
}

await page.emulateMedia({ colorScheme: "light" });
await page.goto(base + "/", { waitUntil: "networkidle" });
const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.emulateMedia({ colorScheme: "dark" });
await page.goto(base + "/", { waitUntil: "networkidle" });
const darkBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
console.log("color-scheme light-emulated", lightBg, "dark-emulated", darkBg);
if (lightBg !== darkBg) fail("site changed with prefers-color-scheme");

await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + "/plaid/redirect?oauth_state_id=sample", { waitUntil: "networkidle" });
await settle();
const openHref = await page.locator("#open-pland").getAttribute("href");
if (openHref !== "pland://plaid/redirect?oauth_state_id=sample") fail("return link " + openHref);
if (page.url().startsWith("pland:")) fail("auto redirected to the app");

const offsite = requests.filter((line) => !line.includes("127.0.0.1") && line !== "POST https://api.pland.ai/waitlist" && line !== "OPTIONS https://api.pland.ai/waitlist");
if (offsite.length) fail("offsite request " + offsite.join(", "));
if (cspViolations.length) fail("csp violation " + cspViolations.join(" | "));

await browser.close();
child.kill();
console.log("capture ok");
