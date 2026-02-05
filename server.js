import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");

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
      if (!payload.user_id) {
        sendJson(res, 400, { ok: false, error: "user_id is required" });
        return;
      }
      await upsertUser(payload);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "invalid json" });
    }
  });
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
  await serveStatic(req, res);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`Server running on ${port}`);
});
