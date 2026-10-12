#!/usr/bin/env node
/**
 * Waitlist store for the static pland.ai site.
 *
 * GitHub Pages serves the HTML and cannot run this process. Host it yourself
 * (or point the form at PlandAutomation's POST /waitlist once that Lambda is
 * deployed) and keep CORS open for https://pland.ai.
 *
 * Stores one JSON object per line. Logs only a status word — never the body.
 * GET /api/waitlist does not read the file back.
 */
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storePath = process.env.WAITLIST_STORE || path.join(os.tmpdir(), "pland-waitlist.jsonl");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";

const HOUSEHOLDS = new Set(["1 adult", "2 adults", "2 adults + kids", "Other"]);
const IOS = new Set(["Yes — we use iPhones", "Mostly iOS", "No / mixed"]);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

const hits = new Map();

function log(status) {
  console.log("waitlist " + status);
}

function allowedOrigin(origin) {
  if (!origin) return false;
  if (origin === "https://pland.ai" || origin === "https://www.pland.ai") return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && allowedOrigin(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  }
}

function sendJson(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function limited(ip) {
  const now = Date.now();
  const row = hits.get(ip) || { n: 0, reset: now + 10 * 60 * 1000 };
  if (now > row.reset) {
    row.n = 0;
    row.reset = now + 10 * 60 * 1000;
  }
  row.n += 1;
  hits.set(ip, row);
  return row.n > 8;
}

function cleanName(value) {
  if (typeof value !== "string") return "";
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 120) return "";
  if (/[\u0000-\u001f]/.test(name)) return "";
  return name;
}

function cleanEmail(value) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  if (email.length > 200) return "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "";
  return email;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 4096) {
        reject(new Error("size"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleWaitlist(req, res) {
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method !== "POST") {
    log("rejected");
    sendJson(res, 405, { ok: false });
    return;
  }
  if (limited(req.socket.remoteAddress || "unknown")) {
    log("rate_limited");
    sendJson(res, 429, { ok: false });
    return;
  }
  let data;
  try {
    data = JSON.parse(await readBody(req));
  } catch {
    log("rejected");
    sendJson(res, 400, { ok: false });
    return;
  }
  if (data && typeof data.pl_hp === "string" && data.pl_hp.trim()) {
    log("spam");
    sendJson(res, 200, { ok: true });
    return;
  }
  const name = cleanName(data && data.name);
  const email = cleanEmail(data && data.email);
  const household = data && HOUSEHOLDS.has(data.household) ? data.household : "";
  const ios = data && IOS.has(data.ios) ? data.ios : "";
  if (!name || !email || !household || !ios) {
    log("rejected");
    sendJson(res, 400, { ok: false });
    return;
  }
  const row = JSON.stringify({
    receivedAt: new Date().toISOString(),
    name,
    email,
    household,
    ios,
  });
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.appendFileSync(storePath, row + "\n", { mode: 0o600 });
  log("stored");
  sendJson(res, 200, { ok: true });
}

function safeFile(urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(root, "." + rel);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  if (file.split(path.sep).some((part) => part.startsWith(".") && part !== ".well-known")) return null;
  return file;
}

function serveStatic(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end();
    return;
  }
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname === "/privacy") {
    res.writeHead(301, { Location: "/privacy/" });
    res.end();
    return;
  }
  const file = safeFile(url.pathname);
  if (!file) {
    res.writeHead(400);
    res.end();
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const type = TYPES[path.extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Content-Length": stat.size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/api/waitlist") {
    handleWaitlist(req, res).catch(() => {
      log("rejected");
      if (!res.headersSent) sendJson(res, 400, { ok: false });
    });
    return;
  }
  serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log("waitlist listening");
});
