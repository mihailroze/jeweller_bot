import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");

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
      const users = await loadUsers();
      const id = String(payload.user_id);
      const now = new Date().toISOString();
      const current = users[id] || { first_seen: now };
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
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "invalid json" });
    }
  });
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
  await serveStatic(req, res);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () => {
  console.log(`Server running on ${port}`);
});
