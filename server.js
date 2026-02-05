import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const SNAPSHOT_DIR = path.join(DATA_DIR, "snapshots");
const VISITS_PATH = path.join(DATA_DIR, "visits.json");
const METALS_PATH = path.join(DATA_DIR, "metals.json");

const BOT_TOKEN = process.env.BOT_TOKEN || "";
const WEBAPP_URL = process.env.WEBAPP_URL || "";
const ADMIN_IDS = new Set(
  (process.env.ADMIN_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function ensureSnapshotDir() {
  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
}

async function loadUsers() {
  try {
    const raw = await fs.readFile(USERS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

async function upsertUser(payload) {
  if (!payload || !payload.user_id) return;
  const users = await loadUsers();
  const id = String(payload.user_id);
  const now = new Date().toISOString();
  const current = users[id] || { first_seen: now, visits: 0 };
  users[id] = {
    user_id: payload.user_id,
    username: payload.username || current.username || null,
    first_name: payload.first_name || current.first_name || null,
    last_name: payload.last_name || current.last_name || null,
    language_code: payload.language_code || current.language_code || null,
    platform: payload.platform || current.platform || null,
    first_seen: current.first_seen,
    last_seen: now,
    visits: (current.visits || 0) + 1,
  };
  await saveUsers(users);
}

async function saveUsers(users) {
  await ensureDataDir();
  await fs.writeFile(USERS_PATH, JSON.stringify(users, null, 2), "utf-8");
}

function getDateKey() {
  return new Date().toISOString().slice(0, 10);
}

async function loadVisits() {
  try {
    const raw = await fs.readFile(VISITS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

async function saveVisits(visits) {
  await ensureDataDir();
  await fs.writeFile(VISITS_PATH, JSON.stringify(visits, null, 2), "utf-8");
}

function normalizeVisitEntry(entry) {
  if (!entry) {
    return {
      total: 0,
      unique_count: 0,
      unique_ids: {},
      by_platform: {
        tg: { total: 0, unique_count: 0, unique_ids: {} },
        web: { total: 0, unique_count: 0, unique_ids: {} },
      },
    };
  }
  if (typeof entry === "number") {
    return {
      total: entry,
      unique_count: entry,
      unique_ids: {},
      by_platform: {
        tg: { total: 0, unique_count: 0, unique_ids: {} },
        web: { total: 0, unique_count: 0, unique_ids: {} },
      },
    };
  }
  const normalizePlatformEntry = (platformEntry) => {
    if (!platformEntry) {
      return { total: 0, unique_count: 0, unique_ids: {} };
    }
    if (typeof platformEntry === "number") {
      return { total: platformEntry, unique_count: platformEntry, unique_ids: {} };
    }
    return {
      total: Number(platformEntry.total) || 0,
      unique_count: Number(platformEntry.unique_count) || 0,
      unique_ids: platformEntry.unique_ids || {},
    };
  };

  const hasPlatform = Boolean(entry.by_platform);
  const byPlatform = entry.by_platform || {};
  return {
    total: Number(entry.total) || 0,
    unique_count: Number(entry.unique_count) || 0,
    unique_ids: entry.unique_ids || {},
    by_platform: {
      tg: hasPlatform
        ? normalizePlatformEntry(byPlatform.tg)
        : normalizePlatformEntry({
            total: entry.total,
            unique_count: entry.unique_count,
            unique_ids: entry.unique_ids,
          }),
      web: hasPlatform ? normalizePlatformEntry(byPlatform.web) : normalizePlatformEntry(null),
    },
  };
}

function buildStats(entry) {
  const tg = entry.by_platform?.tg || { total: 0, unique_count: 0 };
  const web = entry.by_platform?.web || { total: 0, unique_count: 0 };
  return {
    total: entry.total,
    unique: entry.unique_count,
    repeats: Math.max(entry.total - entry.unique_count, 0),
    platforms: {
      tg: {
        total: tg.total || 0,
        unique: tg.unique_count || 0,
        repeats: Math.max((tg.total || 0) - (tg.unique_count || 0), 0),
      },
      web: {
        total: web.total || 0,
        unique: web.unique_count || 0,
        repeats: Math.max((web.total || 0) - (web.unique_count || 0), 0),
      },
    },
  };
}

async function incrementDailyVisit(visitId, platformKey) {
  const visits = await loadVisits();
  const key = getDateKey();
  const entry = normalizeVisitEntry(visits[key]);
  entry.total += 1;
  if (visitId) {
    const id = String(visitId);
    if (!entry.unique_ids[id]) {
      entry.unique_ids[id] = true;
      entry.unique_count += 1;
    }
  }

  const keyPlatform = platformKey === "tg" ? "tg" : "web";
  const platformEntry = entry.by_platform[keyPlatform] || {
    total: 0,
    unique_count: 0,
    unique_ids: {},
  };
  platformEntry.total += 1;
  if (visitId) {
    const id = String(visitId);
    if (!platformEntry.unique_ids[id]) {
      platformEntry.unique_ids[id] = true;
      platformEntry.unique_count += 1;
    }
  }
  entry.by_platform[keyPlatform] = platformEntry;
  visits[key] = entry;
  await saveVisits(visits);
  return buildStats(entry);
}

async function getDailyVisitStats(dateKey) {
  const visits = await loadVisits();
  const entry = normalizeVisitEntry(visits[dateKey]);
  return buildStats(entry);
}

function normalizeMetals(payload) {
  if (!payload || typeof payload !== "object") return null;
  const pricesSource = payload.prices && typeof payload.prices === "object"
    ? payload.prices
    : payload;
  const pick = (key) => {
    const value =
      pricesSource[key] ??
      pricesSource[key.toLowerCase?.() || key] ??
      pricesSource[key.toUpperCase?.() || key];
    if (value === null || value === undefined || value === "") return null;
    const num = Number(String(value).replace(",", "."));
    return Number.isFinite(num) ? num : null;
  };
  return {
    date: payload.date || getDateKey(),
    currency: payload.currency || "RUB",
    unit: payload.unit || "g",
    prices: {
      Au: pick("Au"),
      Ag: pick("Ag"),
      Pt: pick("Pt"),
      Pd: pick("Pd"),
    },
    source: payload.source || null,
    fetched_at: payload.fetched_at || null,
  };
}

function getMetalsFromEnv() {
  const raw = process.env.METAL_PRICES;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeMetals(parsed);
    if (normalized) {
      normalized.source = "env";
      normalized.fetched_at = new Date().toISOString();
    }
    return normalized;
  } catch (error) {
    return null;
  }
}

function formatCbrDate(date) {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function parseCbrRecordDate(value) {
  if (!value) return null;
  const [day, month, year] = value.split(".");
  if (!day || !month || !year) return null;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function parseCbrMetalsXml(xml) {
  const codeMap = {
    1: "Au",
    2: "Ag",
    3: "Pt",
    4: "Pd",
  };
  const records = [];
  const recordRegex =
    /<Record[^>]*Date="([^"]+)"[^>]*Code="([^"]+)"[^>]*>([\s\S]*?)<\/Record>/g;
  let match;
  while ((match = recordRegex.exec(xml)) !== null) {
    const recordDate = parseCbrRecordDate(match[1]);
    const code = Number(match[2]);
    const body = match[3];
    const buyMatch = /<Buy>([^<]+)<\/Buy>/i.exec(body);
    if (!recordDate || !codeMap[code] || !buyMatch) continue;
    const raw = buyMatch[1].replace(",", ".").replace(/\s/g, "");
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    records.push({
      date: recordDate,
      metal: codeMap[code],
      value,
    });
  }

  const latest = {};
  let latestDate = null;
  for (const record of records) {
    if (!latestDate || record.date > latestDate) {
      latestDate = record.date;
    }
    const current = latest[record.metal];
    if (!current || record.date > current.date) {
      latest[record.metal] = record;
    }
  }

  if (!latestDate) return null;
  return {
    date: latestDate.toISOString().slice(0, 10),
    prices: {
      Au: latest.Au?.value ?? null,
      Ag: latest.Ag?.value ?? null,
      Pt: latest.Pt?.value ?? null,
      Pd: latest.Pd?.value ?? null,
    },
  };
}

async function fetchCbrMetals() {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 10);
  const url = `https://www.cbr.ru/scripts/xml_metall.asp?date_req1=${formatCbrDate(
    from
  )}&date_req2=${formatCbrDate(today)}`;
  const response = await fetch(url);
  if (!response.ok) return null;
  const xml = await response.text();
  const parsed = parseCbrMetalsXml(xml);
  if (!parsed) return null;
  return {
    date: parsed.date,
    currency: "RUB",
    unit: "g",
    prices: parsed.prices,
    source: "cbr.ru",
    fetched_at: new Date().toISOString(),
  };
}

async function loadMetals() {
  try {
    const raw = await fs.readFile(METALS_PATH, "utf-8");
    return normalizeMetals(JSON.parse(raw));
  } catch (error) {
    return null;
  }
}

async function saveMetals(payload) {
  await ensureDataDir();
  await fs.writeFile(METALS_PATH, JSON.stringify(payload, null, 2), "utf-8");
}

function shouldRefreshMetals(stored, hasEnv) {
  if (!stored || !stored.fetched_at) return true;
  if (!hasEnv && stored.source === "env") return true;
  const ts = new Date(stored.fetched_at).getTime();
  if (!Number.isFinite(ts)) return true;
  const ageMs = Date.now() - ts;
  return ageMs > 6 * 60 * 60 * 1000;
}

async function handleMetals(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const forceRefresh = url.searchParams.get("refresh") === "1";
  const envMetals = getMetalsFromEnv();
  if (envMetals) {
    await saveMetals(envMetals);
    sendJson(res, 200, { ok: true, ...envMetals });
    return;
  }
  let stored = await loadMetals();
  if (forceRefresh || !stored || shouldRefreshMetals(stored, Boolean(envMetals))) {
    const fetched = await fetchCbrMetals();
    if (fetched) {
      await saveMetals(fetched);
      stored = fetched;
    }
  }
  if (stored) {
    sendJson(res, 200, { ok: true, ...stored });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    date: getDateKey(),
    currency: "RUB",
    unit: "g",
    prices: { Au: null, Ag: null, Pt: null, Pd: null },
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleVisit(req, res) {
  let data = "";
  req.on("data", (chunk) => (data += chunk));
  req.on("end", async () => {
    try {
      const payload = JSON.parse(data || "{}");
      const userId = payload.user_id;
      const clientId = payload.client_id;
      if (!userId && !clientId) {
        sendJson(res, 400, { ok: false, error: "user_id or client_id is required" });
        return;
      }
      if (userId) {
        await upsertUser(payload);
      }
      const visitId = userId ? `tg:${userId}` : `web:${clientId}`;
      const platformKey = userId ? "tg" : "web";
      const stats = await incrementDailyVisit(visitId, platformKey);
      sendJson(res, 200, { ok: true, ...stats });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "invalid json" });
    }
  });
}

function getBaseUrl(req) {
  if (WEBAPP_URL) return WEBAPP_URL.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || "http";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!host) return "";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

async function handleSnapshot(req, res) {
  let data = "";
  let aborted = false;

  req.on("data", (chunk) => {
    if (aborted) return;
    data += chunk;
    if (data.length > 8_000_000) {
      aborted = true;
      sendJson(res, 413, { ok: false, error: "payload too large" });
      req.destroy();
    }
  });

  req.on("end", async () => {
    if (aborted) return;
    try {
      const payload = JSON.parse(data || "{}");
      const dataUrl = payload.dataUrl || "";
      const prefix = "data:image/png;base64,";
      const base64 = dataUrl.startsWith(prefix)
        ? dataUrl.slice(prefix.length)
        : payload.base64 || "";
      if (!base64) {
        sendJson(res, 400, { ok: false, error: "dataUrl required" });
        return;
      }

      const buffer = Buffer.from(base64, "base64");
      if (!buffer.length) {
        sendJson(res, 400, { ok: false, error: "invalid data" });
        return;
      }

      await ensureSnapshotDir();
      const id = randomUUID();
      const filename = `${id}.png`;
      const filePath = path.join(SNAPSHOT_DIR, filename);
      await fs.writeFile(filePath, buffer);

      const baseUrl = getBaseUrl(req);
      const url = baseUrl ? `${baseUrl}/snapshots/${filename}` : `/snapshots/${filename}`;
      sendJson(res, 200, { ok: true, url });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "invalid json" });
    }
  });
}

async function handleVisitCount(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const date = url.searchParams.get("date") || getDateKey();
  const stats = await getDailyVisitStats(date);
  sendJson(res, 200, { ok: true, date, ...stats });
}

function isAdmin(userId) {
  return ADMIN_IDS.has(Number(userId));
}

async function telegramRequest(method, payload) {
  if (!BOT_TOKEN) return { ok: false, error: "BOT_TOKEN missing" };
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json();
}

function makeWebAppKeyboard() {
  if (!WEBAPP_URL) {
    return {
      keyboard: [[{ text: "Открыть WebApp (URL не задан)" }]],
      resize_keyboard: true,
    };
  }
  return {
    keyboard: [[{ text: "Открыть калькулятор", web_app: { url: WEBAPP_URL } }]],
    resize_keyboard: true,
  };
}

function formatUserLine(user) {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const handle = user.username ? `@${user.username}` : "";
  return `${user.user_id} ${name} ${handle}`.trim();
}

async function handleUsersCommand(chatId) {
  const users = await loadUsers();
  const list = Object.values(users);
  list.sort((a, b) => (b.visits || 0) - (a.visits || 0));
  const total = list.length;
  const sample = list.slice(0, 50).map(formatUserLine).join("\n");
  const text =
    `Пользователи: ${total}\n` +
    (sample ? `\n${sample}\n\nПоказаны первые 50.` : "Пока пусто.");
  await telegramRequest("sendMessage", { chat_id: chatId, text });
}

async function handleBroadcast(chatId, text) {
  if (!text) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: "Использование: /broadcast Текст рассылки",
    });
    return;
  }
  const users = await loadUsers();
  const ids = Object.keys(users);
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: `Рассылка начата. Получателей: ${ids.length}`,
  });
  for (const id of ids) {
    await telegramRequest("sendMessage", { chat_id: id, text });
    await new Promise((resolve) => setTimeout(resolve, 35));
  }
  await telegramRequest("sendMessage", {
    chat_id: chatId,
    text: "Рассылка завершена.",
  });
}

async function handleTelegramUpdate(update) {
  const message = update.message;
  if (!message) return;

  const from = message.from;
  if (from && from.id) {
    await upsertUser({
      user_id: from.id,
      username: from.username || null,
      first_name: from.first_name || null,
      last_name: from.last_name || null,
      language_code: from.language_code || null,
      platform: "telegram",
    });
  }

  const chatId = message.chat?.id;
  const text = message.text || "";
  if (!chatId) return;

  if (text.startsWith("/start")) {
    await telegramRequest("sendMessage", {
      chat_id: chatId,
      text: "Откройте калькулятор по кнопке ниже.",
      reply_markup: makeWebAppKeyboard(),
    });
    return;
  }

  if (text.startsWith("/users")) {
    if (!isAdmin(from?.id)) {
      await telegramRequest("sendMessage", {
        chat_id: chatId,
        text: "Нет доступа.",
      });
      return;
    }
    await handleUsersCommand(chatId);
    return;
  }

  if (text.startsWith("/broadcast")) {
    if (!isAdmin(from?.id)) {
      await telegramRequest("sendMessage", {
        chat_id: chatId,
        text: "Нет доступа.",
      });
      return;
    }
    const payload = text.replace("/broadcast", "").trim();
    await handleBroadcast(chatId, payload);
  }
}

async function serveSnapshot(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const filename = path.basename(url.pathname);
  if (!filename || !filename.endsWith(".png")) {
    res.writeHead(404);
    res.end();
    return;
  }
  const filePath = path.join(SNAPSHOT_DIR, filename);
  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": "image/png",
      "Content-Length": content.length,
      "Cache-Control": "public, max-age=604800",
    });
    res.end(content);
  } catch (error) {
    res.writeHead(404);
    res.end();
  }
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname;
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const ext = path.extname(filePath);
    const content = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": content.length,
      "Cache-Control": "public, max-age=120",
    });
    res.end(content);
  } catch (error) {
    res.writeHead(404);
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/visit") {
    await handleVisit(req, res);
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/api/visits")) {
    await handleVisitCount(req, res);
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/api/metals")) {
    await handleMetals(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/snapshot") {
    await handleSnapshot(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/telegram/webhook") {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", async () => {
      try {
        const update = JSON.parse(data || "{}");
        await handleTelegramUpdate(update);
        sendJson(res, 200, { ok: true });
      } catch (error) {
        sendJson(res, 400, { ok: false });
      }
    });
    return;
  }
  if (req.method === "GET" && req.url.startsWith("/snapshots/")) {
    await serveSnapshot(req, res);
    return;
  }
  await serveStatic(req, res);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`Server running on ${port}`);
});
