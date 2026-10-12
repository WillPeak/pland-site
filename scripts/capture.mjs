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
for (const stale of ["waitlist-success-390.png", "waitlist-success-1440.png"]) {
  fs.rmSync(path.join(outDir, stale), { force: true });
}

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (html.includes("/api/waitlist") || html.includes("fetch(")) {
  console.error("homepage still posts");
  process.exit(1);
}
if (!html.includes('action="mailto:hello@pland.ai"')) {
  console.error("form is not a mailto");
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

const browser = await chromium.launch();
const page = await browser.newPage();
await page.emulateMedia({ reducedMotion: "reduce" });
const requests = [];
page.on("request", (req) => requests.push(req.method() + " " + req.url()));

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
    "rolling out to waitlist households first",
    "one bad call sends it back to drafting",
  ]) {
    if (!visible.includes(needle)) fail("missing expanded copy: " + needle);
  }
  if (/Instinct|Apple Health|silent auto-booking|\/api\/waitlist|class="next"|The rest of the week doesn't/i.test(text + await page.content())) {
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
  if (!text.includes("{{LEGAL_ENTITY}}") || !text.includes("{{GOVERNING_LAW}}")) fail("placeholders missing");
  if (/waitlist service|private file/i.test(text)) fail("privacy still describes the unhosted store");
  await page.screenshot({ path: path.join(outDir, name), fullPage: true });
}
await privacy(390, "privacy-390.png");
await privacy(1440, "privacy-1440.png");

await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(base + "/", { waitUntil: "networkidle" });
await settle();
const action = await page.locator("#waitlist-form").getAttribute("action");
if (!action || !action.startsWith("mailto:hello@pland.ai")) fail("form action " + action);
await page.fill("#name", "Sample");
await page.fill("#email", "sample.household@example.com");
await page.selectOption("#household", "2 adults");
await page.selectOption("#ios", "Mostly iOS");
const before = requests.length;
await page.evaluate(() => {
  window.__mail = null;
  window.plOpenMail = (href) => { window.__mail = href; };
});
await page.click("#waitlist-form button");
await page.waitForFunction(() => window.__mail);
const mail = await page.evaluate(() => window.__mail);
if (!mail.startsWith("mailto:hello@pland.ai?")) fail("mailto missing " + mail);
if (mail.includes("/api/waitlist")) fail("mailto points at the backend");
const posted = requests.slice(before).filter((line) => line.includes("/api/waitlist") || line.startsWith("POST "));
if (posted.length) fail("posted: " + posted.join(", "));
console.log("mailto ok");

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
console.log("capture ok");
