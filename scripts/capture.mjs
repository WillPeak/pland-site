import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const playwright = await import(process.env.PLAYWRIGHT_PATH || "playwright");
const chromium = playwright.chromium || playwright.default.chromium;

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "artifacts");
const store = "/tmp/pland-waitlist.jsonl";
const port = 4173;
const base = `http://127.0.0.1:${port}`;

fs.mkdirSync(outDir, { recursive: true });
fs.rmSync(store, { force: true });

const logs = [];
const child = spawn(process.execPath, ["server/waitlist.mjs"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", WAITLIST_STORE: store },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (buf) => logs.push(String(buf)));
child.stderr.on("data", (buf) => logs.push(String(buf)));

function fail(message) {
  console.error(message);
  child.kill();
  process.exit(1);
}

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("server did not start")), 8000);
  child.stdout.on("data", (buf) => {
    if (String(buf).includes("listening")) {
      clearTimeout(timer);
      resolve();
    }
  });
  child.on("exit", (code) => reject(new Error("server exited " + code)));
});

const browser = await chromium.launch();
const page = await browser.newPage();
await page.emulateMedia({ reducedMotion: "reduce" });

async function settle() {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
}

function box(locator) {
  return locator.boundingBox();
}

async function assertFold(width, height) {
  await page.setViewportSize({ width, height });
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await settle();
  const cta = await box(page.locator("#hero-cta"));
  const shot = await box(page.locator(".hero-shot"));
  const waitlist = await box(page.locator("#waitlist"));
  const summary = await box(page.locator("#how summary"));
  const report = { width, height, cta, shot, waitlist, summary };
  console.log("fold", JSON.stringify(report));
  if (!cta || !shot || !waitlist || !summary) fail("missing hero box " + width);
  if (cta.y + cta.height > height + 1) fail("CTA below the fold at " + width);
  if (shot.y + shot.height > height + 1) fail("visual below the fold at " + width);
  if (waitlist.y < height - 2) fail("waitlist peeks into the first screen at " + width);
  if (summary.y < height - 2) fail("See how it works peeks into the first screen at " + width);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (wide) fail("horizontal overflow at " + width);
  const h1 = await page.locator("h1").innerText();
  if (h1 !== "Healthier, wealthier, happier.") fail("unexpected h1");
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
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
}
await expanded(390, "homepage-expanded-390.png");
await expanded(1440, "homepage-expanded-1440.png");

async function privacy(width, name) {
  await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
  const response = await page.goto(base + "/privacy", { waitUntil: "networkidle" });
  if (!page.url().endsWith("/privacy/")) fail("privacy redirect missing");
  if (!response || response.status() >= 400) fail("privacy status");
  await settle();
  const text = await page.locator("main").innerText();
  if (!text.includes("{{LEGAL_ENTITY}}") || !text.includes("{{GOVERNING_LAW}}")) {
    fail("placeholders missing");
  }
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
}
await privacy(390, "privacy-390.png");
await privacy(1440, "privacy-1440.png");

async function success(width, name) {
  await page.setViewportSize({ width, height: width < 800 ? 844 : 900 });
  await page.goto(base + "/?shot=" + width + "#waitlist", { waitUntil: "networkidle" });
  await settle();
  await page.fill("#name", "Sample");
  await page.fill("#email", "sample.household@example.com");
  await page.selectOption("#household", "2 adults");
  await page.selectOption("#ios", "Mostly iOS");
  await page.click("#waitlist-form button");
  await page.waitForSelector("#waitlist-status.ok");
  const message = await page.locator("#waitlist-status").innerText();
  if (!message.includes("You're on the list")) fail("success copy missing");
  if (await page.locator("#waitlist-form").isVisible()) fail("form still visible after success");
  await page.locator("#waitlist-status").evaluate((el) => el.scrollIntoView({ block: "center" }));
  const statusBox = await page.locator("#waitlist-status").boundingBox();
  const viewH = width < 800 ? 844 : 900;
  if (!statusBox || statusBox.y < 0 || statusBox.y + statusBox.height > viewH) {
    fail("success message not in the viewport at " + width + " " + JSON.stringify(statusBox));
  }
  await page.screenshot({ path: path.join(outDir, name) });
}
await success(390, "waitlist-success-390.png");
await success(1440, "waitlist-success-1440.png");

const stored = fs.readFileSync(store, "utf8").trim().split("\n").filter(Boolean);
if (stored.length !== 2) fail("expected 2 stored rows, got " + stored.length);
for (const line of stored) {
  const row = JSON.parse(line);
  if (row.email !== "sample.household@example.com" || row.name !== "Sample") fail("stored row mismatch");
  if (!row.receivedAt || row.household !== "2 adults" || row.ios !== "Mostly iOS") fail("stored fields");
}

await page.goto(base + "/", { waitUntil: "networkidle" });
await page.fill("#name", "Bot");
await page.fill("#email", "bot@example.com");
await page.selectOption("#household", "1 adult");
await page.selectOption("#ios", "No / mixed");
await page.fill("#pl_hp", "spam-co");
let posted = false;
page.on("request", (req) => {
  if (req.url().includes("/api/waitlist")) posted = true;
});
await page.click("#waitlist-form button");
await page.waitForSelector("#waitlist-status.ok");
await page.waitForTimeout(200);
if (posted) fail("honeypot should not post");
const after = fs.readFileSync(store, "utf8");
if (after.includes("bot@example.com")) fail("honeypot was stored");

const bad = await page.evaluate(async () => {
  const res = await fetch("/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Nope", email: "not-an-email", household: "1 adult", ios: "Mostly iOS" }),
  });
  return res.status;
});
if (bad !== 400) fail("invalid email should be 400, got " + bad);

const logText = logs.join("");
if (/sample\.household@example\.com|bot@example\.com|Sample/.test(logText)) fail("PII in logs:\n" + logText);
if (!logText.includes("waitlist stored")) fail("missing stored log");
console.log("logs", logText.split("\n").filter((line) => line.startsWith("waitlist")).join(" | "));

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

await browser.close();
child.kill();
fs.rmSync(store, { force: true });
console.log("capture ok");
