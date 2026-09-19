const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const dotenv = require("dotenv");
const initSqlJs = require("sql.js");

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const ROOT = path.resolve(__dirname, "..");
const FRONTEND = path.join(ROOT, "frontend");
const DB_URL = process.env.DATABASE_URL || "./database/rc-domain.sqlite";
const DB_FILE = path.resolve(ROOT, DB_URL.replace(/^sqlite:\/\//, ""));
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || "development-only-change-me";
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const API_BASE_URL = process.env.API_BASE_URL || `${APP_BASE_URL}/api`;
const COOKIE_SECURE = process.env.COOKIE_SECURE === "true" || APP_BASE_URL.startsWith("https://");
const ALLOWED_ORIGIN = process.env.CORS_ORIGIN || APP_BASE_URL;

let db;
let SQL;

const app = express();
app.set("trust proxy", 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: ALLOWED_ORIGIN === "*" ? true : ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: "250kb" }));
app.use(cookieParser());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: true, legacyHeaders: false }));

function ensureDbDirectory() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
}

function saveDb() {
  ensureDbDirectory();
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  fs.renameSync(tmp, DB_FILE);
}

function rows(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const output = [];
  while (stmt.step()) output.push(stmt.getAsObject());
  stmt.free();
  return output;
}

function one(sql, params = []) {
  return rows(sql, params)[0] || null;
}

function run(sql, params = []) {
  db.run(sql, params);
  saveDb();
}

function uid(prefix = "RCU") {
  return `${prefix}_${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function token() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function now() {
  return new Date().toISOString();
}

function normalizeDomain(value) {
  return String(value || "").trim().toLowerCase().replace(/\.etc$/, "");
}

function fullDomain(value) {
  return `${normalizeDomain(value)}.etc`;
}

function validLabel(value) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value) && !value.includes("--");
}

function safeUser(user) {
  if (!user) return null;
  const { password_hash, ...publicUser } = user;
  return publicUser;
}

function structuredError(res, status, code, message, details = {}) {
  return res.status(status).json({ success: false, error: { code, message, details } });
}

function ok(res, data = {}) {
  return res.json({ success: true, ...data });
}

function audit(action, actorUid, target, details = {}, ip = null) {
  db.run(
    `INSERT INTO audit_logs (id, action, actor_uid, target, timestamp, ip, details)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uid("AUD"), action, actorUid || "SYSTEM", target || "-", now(), ip, JSON.stringify(details)]
  );
  saveDb();
}

function notify(userUid, title, body, type = "info") {
  db.run(
    `INSERT INTO notifications (id, user_uid, title, body, type, is_read, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [uid("NTF"), userUid, title, body, type, now()]
  );
  saveDb();
}

function sessionFromRequest(req) {
  const raw = req.cookies.rc_session;
  if (!raw) return null;
  const session = one(
    `SELECT s.*, u.uid, u.role, u.status, u.username, u.email, u.full_name
     FROM sessions s JOIN users u ON u.uid = s.user_uid
     WHERE s.token_hash = ? AND s.expires_at > ?`,
    [hashToken(raw), now()]
  );
  return session || null;
}

function requireAuth(req, res, next) {
  const session = sessionFromRequest(req);
  if (!session) return structuredError(res, 401, "AUTH_REQUIRED", "Please log in to continue.");
  req.session = session;
  next();
}

function requireAdmin(req, res, next) {
  const session = sessionFromRequest(req);
  if (!session) return structuredError(res, 401, "AUTH_REQUIRED", "Admin login is required.");
  if (session.role !== "ADMIN") return structuredError(res, 403, "ADMIN_REQUIRED", "Administrator access is required.");
  req.session = session;
  next();
}

function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || ["/setup/admin", "/auth/register", "/auth/login", "/admin/login"].includes(req.path)) return next();
  const csrfCookie = req.cookies.rc_csrf;
  const csrfHeader = req.get("x-csrf-token");
  if (!csrfCookie || csrfCookie !== csrfHeader) {
    return structuredError(res, 403, "CSRF_FAILED", "Security token missing or expired. Refresh the page and try again.");
  }
  next();
}

app.use("/api", requireCsrf);

app.get("/api/health", (req, res) => {
  ok(res, {
    status: "online",
    registry: "online",
    dns: "online",
    database: db ? "online" : "offline",
    timestamp: now(),
    publicWebsiteUrl: APP_BASE_URL
  });
});

app.get("/api/public/config", (req, res) => {
  ok(res, { appBaseUrl: APP_BASE_URL, apiBaseUrl: API_BASE_URL, extension: ".etc", experimental: true });
});

app.get("/api/setup/status", (req, res) => {
  ok(res, { setupRequired: !one("SELECT uid FROM users WHERE role = 'ADMIN'"), enabled: process.env.ADMIN_SETUP_ENABLED !== "false" });
});

app.post("/api/setup/admin", async (req, res) => {
  if (process.env.ADMIN_SETUP_ENABLED === "false") return structuredError(res, 403, "SETUP_DISABLED", "First-run admin setup is disabled by configuration.");
  if (one("SELECT uid FROM users WHERE role = 'ADMIN'")) return structuredError(res, 409, "ADMIN_EXISTS", "First-run admin setup has already been completed.");
  const { fullName, email, username, password, confirmPassword } = req.body || {};
  if (!fullName || !email || !username || !password || password !== confirmPassword) {
    return structuredError(res, 400, "INVALID_SETUP", "Complete every field and make sure both passwords match.");
  }
  if (password.length < 10) return structuredError(res, 400, "WEAK_PASSWORD", "Password must be at least 10 characters.");
  if (!/^\S+@\S+\.\S+$/.test(email)) return structuredError(res, 400, "INVALID_EMAIL", "Enter a valid email address.");
  const existing = one("SELECT uid FROM users WHERE lower(email) = lower(?) OR lower(username) = lower(?)", [email.trim(), username.trim()]);
  if (existing) return structuredError(res, 409, "ACCOUNT_EXISTS", "That email or username is already in use.");
  const newUid = uid();
  const passwordHash = await bcrypt.hash(password, 12);
  run(
    `INSERT INTO users (uid, full_name, username, email, password_hash, created_at, status, max_domains, current_domain_count, role, email_verified, admin_notes)
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 100, 0, 'ADMIN', 1, ?)`,
    [newUid, fullName.trim(), username.trim(), email.trim().toLowerCase(), passwordHash, now(), "Initial administrator"]
  );
  audit("User created", newUid, newUid, { role: "ADMIN", firstRun: true }, req.ip);
  ok(res, { message: "Administrator account created.", user: safeUser(one("SELECT * FROM users WHERE uid = ?", [newUid])) });
});

function issueSession(res, userUid, role) {
  const raw = token();
  const csrf = token();
  run(
    `INSERT INTO sessions (id, user_uid, token_hash, csrf_token, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [uid("SES"), userUid, hashToken(raw), csrf, now(), new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString()]
  );
  res.cookie("rc_session", raw, { httpOnly: true, secure: COOKIE_SECURE, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000, path: "/" });
  res.cookie("rc_csrf", csrf, { httpOnly: false, secure: COOKIE_SECURE, sameSite: "lax", maxAge: 7 * 24 * 60 * 60 * 1000, path: "/" });
}

async function login(req, res, role) {
  const { identifier, password } = req.body || {};
  const user = one("SELECT * FROM users WHERE lower(email) = lower(?) OR lower(username) = lower(?)", [identifier || "", identifier || ""]);
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) {
    audit("Failed login", null, identifier || "-", { role }, req.ip);
    return structuredError(res, 401, "INVALID_CREDENTIALS", "The username/email or password is incorrect.");
  }
  if (role === "ADMIN" && user.role !== "ADMIN") return structuredError(res, 403, "ADMIN_REQUIRED", "This account is not an administrator.");
  if (role === "USER" && user.role === "ADMIN") return structuredError(res, 400, "USE_ADMIN_LOGIN", "Use the administrator login for this account.");
  if (user.status === "SUSPENDED") return structuredError(res, 403, "ACCOUNT_SUSPENDED", "Your account is suspended. Contact an administrator.");
  issueSession(res, user.uid, user.role);
  run("UPDATE users SET last_login = ? WHERE uid = ?", [now(), user.uid]);
  audit(role === "ADMIN" ? "Admin login" : "User login", user.uid, user.uid, {}, req.ip);
  ok(res, { user: safeUser(one("SELECT * FROM users WHERE uid = ?", [user.uid])) });
}

app.post("/api/auth/register", async (req, res) => {
  const { fullName, username, email, password, confirmPassword } = req.body || {};
  if (!fullName || !username || !email || !password || password !== confirmPassword) return structuredError(res, 400, "INVALID_REGISTRATION", "Complete every field and make sure both passwords match.");
  if (password.length < 10) return structuredError(res, 400, "WEAK_PASSWORD", "Password must be at least 10 characters.");
  if (!/^\S+@\S+\.\S+$/.test(email)) return structuredError(res, 400, "INVALID_EMAIL", "Enter a valid email address.");
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return structuredError(res, 400, "INVALID_USERNAME", "Username must be 3–24 letters, numbers, or underscores.");
  const existing = one("SELECT uid FROM users WHERE lower(email) = lower(?) OR lower(username) = lower(?)", [email.trim(), username.trim()]);
  if (existing) return structuredError(res, 409, "ACCOUNT_EXISTS", "That email or username is already in use.");
  const newUid = uid();
  const passwordHash = await bcrypt.hash(password, 12);
  run(
    `INSERT INTO users (uid, full_name, username, email, password_hash, created_at, status, max_domains, current_domain_count, role, email_verified, admin_notes)
     VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, 0, 'USER', 0, '')`,
    [newUid, fullName.trim(), username.trim(), email.trim().toLowerCase(), passwordHash, now()]
  );
  audit("User created", newUid, newUid, { role: "USER", status: "PENDING" }, req.ip);
  ok(res, { message: "Registration submitted. An administrator must approve your account before domain registration.", uid: newUid });
});

app.post("/api/auth/login", (req, res) => login(req, res, "USER"));
app.post("/api/admin/login", (req, res) => login(req, res, "ADMIN"));

app.post("/api/auth/logout", requireAuth, (req, res) => {
  run("DELETE FROM sessions WHERE id = ?", [req.session.id]);
  res.clearCookie("rc_session", { path: "/" });
  res.clearCookie("rc_csrf", { path: "/" });
  audit(req.session.role === "ADMIN" ? "Admin logout" : "User logout", req.session.uid, req.session.uid, {}, req.ip);
  ok(res, { message: "Logged out." });
});

app.get("/api/auth/me", requireAuth, (req, res) => ok(res, { user: safeUser(one("SELECT * FROM users WHERE uid = ?", [req.session.uid])) }));

app.get("/api/dashboard", requireAuth, (req, res) => {
  const user = one("SELECT * FROM users WHERE uid = ?", [req.session.uid]);
  const notifications = rows("SELECT * FROM notifications WHERE user_uid = ? ORDER BY created_at DESC LIMIT 8", [req.session.uid]);
  const activity = rows("SELECT * FROM audit_logs WHERE actor_uid = ? OR target = ? ORDER BY timestamp DESC LIMIT 8", [req.session.uid, req.session.uid]);
  ok(res, { user: safeUser(user), notifications, activity });
});

app.get("/api/notifications", requireAuth, (req, res) => ok(res, { notifications: rows("SELECT * FROM notifications WHERE user_uid = ? ORDER BY created_at DESC LIMIT 50", [req.session.uid]) }));

app.get("/api/domains/search", (req, res) => {
  const label = normalizeDomain(req.query.name);
  if (!label || !validLabel(label)) return structuredError(res, 400, "INVALID_DOMAIN", "Use a valid .etc name with letters, numbers, or hyphens.");
  const domain = fullDomain(label);
  const found = one("SELECT domain, status, suspension_reason FROM domains WHERE domain = ?", [domain]);
  if (!found) return ok(res, { result: { domain, status: "AVAILABLE", label, extension: ".etc" } });
  ok(res, { result: { domain: found.domain, status: found.status, reason: found.suspension_reason || null, label, extension: ".etc" } });
});

app.post("/api/domains", requireAuth, (req, res) => {
  const label = normalizeDomain(req.body?.domain);
  const user = one("SELECT * FROM users WHERE uid = ?", [req.session.uid]);
  const existing = one("SELECT * FROM domains WHERE domain = ?", [fullDomain(label)]);
  if (!validLabel(label)) return structuredError(res, 400, "INVALID_DOMAIN", "Domain syntax is invalid.");
  if (existing) return structuredError(res, 409, "DOMAIN_UNAVAILABLE", `Registration unavailable: ${fullDomain(label)} is ${String(existing.status).toLowerCase()}.`, { status: existing.status });
  if (user.status !== "ACTIVE") return structuredError(res, 403, "ACCOUNT_NOT_ACTIVE", `Registration unavailable: your account is ${String(user.status).toLowerCase()}.`);
  if (Number(user.current_domain_count) >= Number(user.max_domains)) return structuredError(res, 403, "DOMAIN_LIMIT_REACHED", "You have reached your maximum domain limit.", { current: user.current_domain_count, maximum: user.max_domains });
  const domain = fullDomain(label);
  run(
    `INSERT INTO domains (domain, owner_uid, registered_at, status, suspension_reason, suspended_by, updated_at, dns_status)
     VALUES (?, ?, ?, 'ACTIVE', '', '', ?, 'TEST/PRIVATE')`,
    [domain, user.uid, now(), now()]
  );
  run("UPDATE users SET current_domain_count = current_domain_count + 1 WHERE uid = ?", [user.uid]);
  audit("Domain registered", user.uid, domain, {}, req.ip);
  notify(user.uid, "Domain registered", `${domain} is now active in the RC Domain testing registry.`, "success");
  ok(res, { message: `${domain} registered successfully.`, domain: one("SELECT * FROM domains WHERE domain = ?", [domain]) });
});

app.get("/api/domains", requireAuth, (req, res) => ok(res, { domains: rows("SELECT * FROM domains WHERE owner_uid = ? ORDER BY registered_at DESC", [req.session.uid]) }));
app.get("/api/domains/my", requireAuth, (req, res) => ok(res, { domains: rows("SELECT * FROM domains WHERE owner_uid = ? ORDER BY registered_at DESC", [req.session.uid]) }));

app.get("/api/domains/:domain", requireAuth, (req, res) => {
  const domain = fullDomain(req.params.domain);
  const found = one("SELECT * FROM domains WHERE domain = ?", [domain]);
  if (!found || (found.owner_uid !== req.session.uid && req.session.role !== "ADMIN")) return structuredError(res, 404, "DOMAIN_NOT_FOUND", "Domain not found.");
  ok(res, { domain: found, dnsRecords: rows("SELECT * FROM dns_records WHERE domain = ? ORDER BY type, name", [domain]) });
});

function checkDns(record) {
  const validTypes = ["A", "AAAA", "CNAME", "MX", "TXT", "NS"];
  if (!validTypes.includes(String(record.type || "").toUpperCase())) return "Record type must be A, AAAA, CNAME, MX, TXT, or NS.";
  if (!record.name || !record.value) return "Record name and value are required.";
  if (!Number.isInteger(Number(record.ttl)) || Number(record.ttl) < 60 || Number(record.ttl) > 86400) return "TTL must be between 60 and 86400 seconds.";
  if (record.type === "A" && !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(record.value)) return "A record value must be an IPv4 address.";
  return null;
}

app.post("/api/domains/:domain/dns", requireAuth, (req, res) => {
  const domain = fullDomain(req.params.domain);
  const found = one("SELECT * FROM domains WHERE domain = ?", [domain]);
  if (!found || found.owner_uid !== req.session.uid) return structuredError(res, 404, "DOMAIN_NOT_FOUND", "Domain not found.");
  if (found.status !== "ACTIVE") return structuredError(res, 403, "DOMAIN_NOT_ACTIVE", "DNS changes are unavailable while this domain is not active.");
  const record = { ...req.body, type: String(req.body.type || "").toUpperCase(), ttl: Number(req.body.ttl || 3600) };
  const validationError = checkDns(record);
  if (validationError) return structuredError(res, 400, "INVALID_DNS_RECORD", validationError);
  const id = uid("DNS");
  run("INSERT INTO dns_records (id, domain, name, type, value, ttl, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, domain, record.name, record.type, record.value, record.ttl, now(), now()]);
  audit("DNS record added", req.session.uid, domain, { recordId: id, type: record.type }, req.ip);
  notify(req.session.uid, "DNS record added", `${record.type} record added to ${domain}.`, "success");
  ok(res, { record: one("SELECT * FROM dns_records WHERE id = ?", [id]) });
});

app.put("/api/domains/:domain/dns/:id", requireAuth, (req, res) => {
  const domain = fullDomain(req.params.domain);
  const found = one("SELECT * FROM domains WHERE domain = ? AND owner_uid = ?", [domain, req.session.uid]);
  if (!found) return structuredError(res, 404, "DOMAIN_NOT_FOUND", "Domain not found.");
  const record = { ...req.body, type: String(req.body.type || "").toUpperCase(), ttl: Number(req.body.ttl || 3600) };
  const validationError = checkDns(record);
  if (validationError) return structuredError(res, 400, "INVALID_DNS_RECORD", validationError);
  run("UPDATE dns_records SET name = ?, type = ?, value = ?, ttl = ?, updated_at = ? WHERE id = ? AND domain = ?", [record.name, record.type, record.value, record.ttl, now(), req.params.id, domain]);
  audit("DNS record modified", req.session.uid, domain, { recordId: req.params.id }, req.ip);
  ok(res, { message: "DNS record updated." });
});

app.delete("/api/domains/:domain/dns/:id", requireAuth, (req, res) => {
  const domain = fullDomain(req.params.domain);
  const found = one("SELECT * FROM domains WHERE domain = ? AND owner_uid = ?", [domain, req.session.uid]);
  if (!found) return structuredError(res, 404, "DOMAIN_NOT_FOUND", "Domain not found.");
  run("DELETE FROM dns_records WHERE id = ? AND domain = ?", [req.params.id, domain]);
  audit("DNS record deleted", req.session.uid, domain, { recordId: req.params.id }, req.ip);
  ok(res, { message: "DNS record deleted." });
});

app.get("/api/admin/overview", requireAdmin, (req, res) => {
  ok(res, {
    metrics: {
      totalUsers: one("SELECT COUNT(*) AS count FROM users").count,
      pendingUsers: one("SELECT COUNT(*) AS count FROM users WHERE status = 'PENDING'").count,
      activeUsers: one("SELECT COUNT(*) AS count FROM users WHERE status = 'ACTIVE'").count,
      suspendedUsers: one("SELECT COUNT(*) AS count FROM users WHERE status = 'SUSPENDED'").count,
      totalDomains: one("SELECT COUNT(*) AS count FROM domains WHERE owner_uid IS NOT NULL").count,
      activeDomains: one("SELECT COUNT(*) AS count FROM domains WHERE status = 'ACTIVE' AND owner_uid IS NOT NULL").count,
      suspendedDomains: one("SELECT COUNT(*) AS count FROM domains WHERE status = 'SUSPENDED'").count
    },
    recentRegistrations: rows("SELECT d.*, u.username FROM domains d LEFT JOIN users u ON u.uid = d.owner_uid ORDER BY d.registered_at DESC LIMIT 8"),
    recentActions: rows("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 8")
  });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const search = `%${String(req.query.search || "").toLowerCase()}%`;
  const status = String(req.query.status || "ALL").toUpperCase();
  const query = status === "ALL"
    ? `SELECT * FROM users WHERE lower(uid) LIKE ? OR lower(email) LIKE ? OR lower(username) LIKE ? OR lower(full_name) LIKE ? ORDER BY created_at DESC`
    : `SELECT * FROM users WHERE status = ? AND (lower(uid) LIKE ? OR lower(email) LIKE ? OR lower(username) LIKE ? OR lower(full_name) LIKE ?) ORDER BY created_at DESC`;
  const params = status === "ALL" ? [search, search, search, search] : [status, search, search, search, search];
  ok(res, { users: rows(query, params).map(safeUser) });
});

app.get("/api/admin/users/:uid", requireAdmin, (req, res) => {
  const user = one("SELECT * FROM users WHERE uid = ?", [req.params.uid]);
  if (!user) return structuredError(res, 404, "USER_NOT_FOUND", "User not found.");
  ok(res, { user: safeUser(user), domains: rows("SELECT * FROM domains WHERE owner_uid = ?", [req.params.uid]), activity: rows("SELECT * FROM audit_logs WHERE actor_uid = ? OR target = ? ORDER BY timestamp DESC LIMIT 20", [req.params.uid, req.params.uid]) });
});

app.post("/api/admin/users/:uid/status", requireAdmin, (req, res) => {
  const { status, reason = "", note = "" } = req.body || {};
  const allowed = ["ACTIVE", "DEACTIVATED", "SUSPENDED"];
  if (!allowed.includes(status)) return structuredError(res, 400, "INVALID_STATUS", "Unsupported account status.");
  if ((status === "SUSPENDED" || status === "DEACTIVATED") && !reason.trim()) return structuredError(res, 400, "REASON_REQUIRED", `A reason is required to ${status.toLowerCase()} a user.`);
  const user = one("SELECT * FROM users WHERE uid = ?", [req.params.uid]);
  if (!user) return structuredError(res, 404, "USER_NOT_FOUND", "User not found.");
  run("UPDATE users SET status = ?, admin_notes = ? WHERE uid = ?", [status, note || reason, req.params.uid]);
  audit(`User ${status.toLowerCase()}`, req.session.uid, req.params.uid, { reason, note }, req.ip);
  notify(req.params.uid, `Account ${status.toLowerCase()}`, status === "ACTIVE" ? "Your account has been approved/activated." : `Your account is ${status.toLowerCase()}. Reason: ${reason}`, status === "ACTIVE" ? "success" : "warning");
  ok(res, { message: `User ${status.toLowerCase()} successfully.` });
});

app.post("/api/admin/users/:uid/limit", requireAdmin, (req, res) => {
  const maximum = Number(req.body.maximum);
  const user = one("SELECT * FROM users WHERE uid = ?", [req.params.uid]);
  if (!user || !Number.isInteger(maximum) || maximum < 0 || maximum > 10000) return structuredError(res, 400, "INVALID_LIMIT", "Enter a whole-number domain limit between 0 and 10000.");
  run("UPDATE users SET max_domains = ? WHERE uid = ?", [maximum, req.params.uid]);
  audit("Domain limit changed", req.session.uid, req.params.uid, { from: user.max_domains, to: maximum }, req.ip);
  notify(req.params.uid, "Domain limit changed", `Your maximum domain limit is now ${maximum}.`, "info");
  ok(res, { message: "Domain limit updated." });
});

app.get("/api/admin/domains", requireAdmin, (req, res) => ok(res, { domains: rows("SELECT d.*, u.full_name, u.username, u.email FROM domains d LEFT JOIN users u ON u.uid = d.owner_uid ORDER BY d.updated_at DESC") }));

app.post("/api/admin/domains/:domain/status", requireAdmin, (req, res) => {
  const domain = fullDomain(req.params.domain);
  const { status, reason = "" } = req.body || {};
  const allowed = ["ACTIVE", "SUSPENDED", "DEACTIVATED", "RESERVED"];
  if (!allowed.includes(status)) return structuredError(res, 400, "INVALID_STATUS", "Unsupported domain status.");
  if (status === "SUSPENDED" && !reason.trim()) return structuredError(res, 400, "REASON_REQUIRED", "A suspension reason is mandatory.");
  const found = one("SELECT * FROM domains WHERE domain = ?", [domain]);
  if (!found) return structuredError(res, 404, "DOMAIN_NOT_FOUND", "Domain not found.");
  run("UPDATE domains SET status = ?, suspension_reason = ?, suspended_by = ?, updated_at = ? WHERE domain = ?", [status, status === "SUSPENDED" ? reason : "", status === "SUSPENDED" ? req.session.uid : "", now(), domain]);
  audit(`Domain ${status.toLowerCase()}`, req.session.uid, domain, { reason }, req.ip);
  if (found.owner_uid) notify(found.owner_uid, `Domain ${status.toLowerCase()}`, `${domain} is now ${status.toLowerCase()}.${reason ? ` Reason: ${reason}` : ""}`, status === "ACTIVE" ? "success" : "warning");
  ok(res, { message: `Domain ${status.toLowerCase()} successfully.` });
});

app.get("/api/admin/audit", requireAdmin, (req, res) => ok(res, { logs: rows("SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT 200") }));
app.get("/api/admin/system", requireAdmin, (req, res) => ok(res, {
  services: [
    { name: "Frontend", status: "ONLINE", detail: APP_BASE_URL },
    { name: "Backend API", status: "ONLINE", detail: API_BASE_URL },
    { name: "SQLite database", status: "ONLINE", detail: DB_FILE },
    { name: "Registry foundation", status: "ONLINE", detail: process.env.REGISTRY_SERVER_URL || "not configured" },
    { name: "DNS foundation", status: "WARNING", detail: process.env.DNS_SERVER_URL || "TEST/PRIVATE" }
  ],
  configuration: { appBaseUrl: APP_BASE_URL, apiBaseUrl: API_BASE_URL, registryServerUrl: process.env.REGISTRY_SERVER_URL || "", dnsServerUrl: process.env.DNS_SERVER_URL || "", corsOrigin: ALLOWED_ORIGIN }
}));

app.use(express.static(FRONTEND));
app.get("*", (req, res) => res.sendFile(path.join(FRONTEND, "index.html")));

async function boot() {
  SQL = await initSqlJs({ locateFile: file => path.join(ROOT, "node_modules", "sql.js", "dist", file) });
  ensureDbDirectory();
  db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
  db.run(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      uid TEXT PRIMARY KEY, full_name TEXT NOT NULL, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING', max_domains INTEGER NOT NULL DEFAULT 0,
      current_domain_count INTEGER NOT NULL DEFAULT 0, role TEXT NOT NULL DEFAULT 'USER',
      last_login TEXT, email_verified INTEGER NOT NULL DEFAULT 0, admin_notes TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS domains (
      domain TEXT PRIMARY KEY, owner_uid TEXT, registered_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE',
      suspension_reason TEXT NOT NULL DEFAULT '', suspended_by TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL,
      dns_status TEXT NOT NULL DEFAULT 'TEST/PRIVATE', FOREIGN KEY (owner_uid) REFERENCES users(uid)
    );
    CREATE TABLE IF NOT EXISTS dns_records (
      id TEXT PRIMARY KEY, domain TEXT NOT NULL, name TEXT NOT NULL, type TEXT NOT NULL, value TEXT NOT NULL,
      ttl INTEGER NOT NULL DEFAULT 3600, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY (domain) REFERENCES domains(domain) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS domain_status_history (id TEXT PRIMARY KEY, domain TEXT NOT NULL, old_status TEXT, new_status TEXT, reason TEXT, actor_uid TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS user_status_history (id TEXT PRIMARY KEY, user_uid TEXT NOT NULL, old_status TEXT, new_status TEXT, reason TEXT, actor_uid TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin_actions (id TEXT PRIMARY KEY, action TEXT NOT NULL, actor_uid TEXT, target TEXT, details TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, action TEXT NOT NULL, actor_uid TEXT, target TEXT, timestamp TEXT NOT NULL, ip TEXT, details TEXT);
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_uid TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, csrf_token TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_uid TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, type TEXT NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, FOREIGN KEY (user_uid) REFERENCES users(uid) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS system_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  if (!one("SELECT domain FROM domains WHERE domain = 'rc.etc'")) {
    db.run("INSERT INTO domains (domain, owner_uid, registered_at, status, suspension_reason, suspended_by, updated_at, dns_status) VALUES ('rc.etc', NULL, ?, 'RESERVED', '', 'SYSTEM', ?, 'TEST/PRIVATE')", [now(), now()]);
    db.run("INSERT INTO domains (domain, owner_uid, registered_at, status, suspension_reason, suspended_by, updated_at, dns_status) VALUES ('admin.etc', NULL, ?, 'RESERVED', '', 'SYSTEM', ?, 'TEST/PRIVATE')", [now(), now()]);
  }
  saveDb();
  if (process.argv.includes("--init-db")) {
    console.log(`Database initialized at ${DB_FILE}`);
    process.exit(0);
  }
  http.createServer(app).listen(PORT, "0.0.0.0", () => {
    console.log(`RC Domain running on ${APP_BASE_URL}`);
    console.log(`API health: ${API_BASE_URL}/health`);
  });
}

boot().catch(error => {
  console.error("RC Domain failed to start:", error);
  process.exit(1);
});
