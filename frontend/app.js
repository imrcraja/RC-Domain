const state = { user: null, setup: false, setupEnabled: true, query: "", search: null, admin: null };
const app = document.getElementById("app");

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const fmtDate = value => value ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";
const statusClass = value => String(value || "").toLowerCase().replace("deactivated", "warning");
const cookie = name => document.cookie.split("; ").find(row => row.startsWith(`${name}=`))?.split("=")[1] || "";

function sound(kind = "success") {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = kind === "error" ? 180 : kind === "click" ? 320 : 520;
    gain.gain.setValueAtTime(.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.06, ctx.currentTime + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + (kind === "click" ? .07 : .14));
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + .16);
  } catch (_) {}
}

async function api(path, options = {}) {
  const opts = { credentials: "include", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options };
  if (["POST", "PUT", "DELETE"].includes(opts.method)) opts.headers["x-csrf-token"] = cookie("rc_csrf");
  const response = await fetch(`/api${path}`, opts);
  const data = await response.json().catch(() => ({ success: false, error: { message: "Invalid server response." } }));
  if (!response.ok || data.success === false) {
    const error = new Error(data.error?.message || "Request failed.");
    error.payload = data.error;
    throw error;
  }
  return data;
}

function toast(message, type = "success") {
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  sound(type === "error" ? "error" : "success");
  setTimeout(() => node.remove(), 3500);
}

function go(route) {
  window.history.pushState({}, "", route);
  render();
  window.scrollTo(0, 0);
}

function header() {
  return `<header class="topbar">
    <a class="brand" href="/" data-route><span class="brand-mark">RC</span><span>RC Domain<small>Experimental registry</small></span></a>
    <nav class="nav"><a href="/domains" data-route>Domains</a><a href="/system-status" data-route>System status</a><a href="/domain-rules" data-route>Rules</a></nav>
    <div class="nav-actions">${state.user ? `<a class="button secondary small" href="${state.user.role === "ADMIN" ? "/admin" : "/dashboard"}" data-route>${state.user.role === "ADMIN" ? "Admin console" : "Dashboard"}</a><button class="button ghost small" data-action="logout">Log out</button>` : `<a class="button ghost small" href="/login" data-route>Log in</a><a class="button primary small" href="/register" data-route>Get started</a>`}</div>
  </header>`;
}

function footer() {
  return `<footer class="footer"><span>© ${new Date().getFullYear()} RC Domain</span><span>Experimental .etc registry · TEST/PRIVATE DNS · <a href="/privacy" data-route>Privacy</a> · <a href="/terms" data-route>Terms</a></span></footer>`;
}

function publicLayout(content) { return `<div class="shell">${header()}<main>${content}</main>${footer()}</div>`; }

function home() {
  return publicLayout(`<div class="page">
    <section class="hero"><div><div class="eyebrow">Private testing registry · .etc</div><h1>Names that are <span class="gradient-text">yours to build.</span></h1><p class="lead">RC Domain is an experimental domain-registry prototype for creating, managing, and testing .etc names with a clean, serious control plane.</p><div class="hero-actions"><a class="button primary" href="/domains/search" data-route>Find a .etc domain</a><a class="button secondary" href="/domain-rules" data-route>Read registry rules</a></div><p class="hint" style="margin-top:18px">.etc is a private testing extension in this prototype. It is not an officially delegated public DNS TLD.</p></div>
      <div class="hero-panel"><div class="panel-head"><div><span class="eyebrow">Quick search</span><h3 style="margin-top:7px">Check availability</h3></div><span class="status-dot online">Registry online</span></div><form id="quick-search" class="search-row"><input class="input" name="name" placeholder="your-name" autocomplete="off" /><button class="button primary">Search</button></form><div id="quick-result" class="hint" style="margin-top:16px">Search a name to see whether it is available.</div><div class="grid three" style="margin-top:28px"><div><strong>01</strong><div class="hint">Search</div></div><div><strong>02</strong><div class="hint">Register</div></div><div><strong>03</strong><div class="hint">Manage DNS</div></div></div></div>
    </section>
    <section class="section"><div class="section-head"><div><div class="eyebrow">Built for testing</div><h2>A focused registry control plane.</h2><p>Real API-backed workflows, not a visual-only demo.</p></div></div><div class="grid three"><div class="card"><div class="feature-icon">⌁</div><h3>Public-test ready</h3><p>Configurable public URLs, proxy-aware sessions, CORS, health checks, and copy-paste Termux instructions.</p></div><div class="card"><div class="feature-icon">◈</div><h3>Approval-led access</h3><p>New accounts start pending. Administrators control status, domain limits, moderation, and audit history.</p></div><div class="card"><div class="feature-icon">⌘</div><h3>DNS foundation</h3><p>Manage A, AAAA, CNAME, MX, TXT, and NS records while clearly marking the system TEST/PRIVATE.</p></div></div></section>
    <section class="section"><div class="notice"><strong>Testing notice</strong><br/>This prototype is designed for public Internet testing through an HTTPS tunnel. It does not claim global .etc resolution. Never expose the database or admin interfaces directly.</div></section>
  </div>`);
}

function authPage(mode = "login") {
  const admin = mode === "admin";
  const setup = mode === "setup";
  const title = setup ? "Create the first administrator" : admin ? "Administrator login" : mode === "register" ? "Create your account" : "Welcome back";
  const subtitle = setup ? "This secure wizard appears only before the first admin exists." : admin ? "Manage users, domains, DNS foundation, and audit logs." : mode === "register" ? "Your account will remain pending until an administrator approves it." : "Sign in to manage your .etc domains.";
  return publicLayout(`<div class="auth-wrap"><div class="auth-card card"><div class="eyebrow">${admin ? "Admin console" : setup ? "First-run setup" : "RC Domain account"}</div><h2 style="margin-top:10px">${title}</h2><p class="hint" style="margin:10px 0 24px">${subtitle}</p><div id="form-message"></div>
    <form id="${setup ? "setup-form" : mode === "register" ? "register-form" : "login-form"}" class="form">
      ${setup || mode === "register" ? `<div class="field"><label>Full name</label><input class="input" name="fullName" required /></div>` : ""}
      ${setup || mode === "register" ? `<div class="field"><label>Username</label><input class="input" name="username" required /></div>` : ""}
      ${setup || mode === "register" ? `<div class="field"><label>Email</label><input class="input" name="email" type="email" required /></div>` : ""}
      ${!setup && mode !== "register" ? `<div class="field"><label>Username or email</label><input class="input" name="identifier" required autocomplete="username" /></div>` : ""}
      <div class="field"><label>Password</label><input class="input" name="password" type="password" required minlength="10" autocomplete="${mode === "login" || admin ? "current-password" : "new-password"}" /></div>
      ${setup || mode === "register" ? `<div class="field"><label>Confirm password</label><input class="input" name="confirmPassword" type="password" required minlength="10" /></div><div class="hint">Use at least 10 characters. Passwords are securely hashed and never displayed.</div>` : ""}
      <button class="button primary" type="submit">${setup ? "Create administrator" : mode === "register" ? "Submit registration" : admin ? "Log in as admin" : "Log in"}</button>
    </form>
    <div class="form-footer">${setup ? "First-run setup is disabled after an admin exists." : admin ? `User account? <a href="/login" data-route>Go to user login</a>` : mode === "register" ? `Already registered? <a href="/login" data-route>Log in</a>` : `No account? <a href="/register" data-route>Create one</a>`}</div>
  </div></div>`);
}

function sideNav(admin = false) {
  const links = admin ? [["/admin","Dashboard"],["/admin/users","Users"],["/admin/domains","Domains"],["/admin/vip","VIP / Limits"],["/admin/audit","Audit logs"],["/admin/system","System"]] : [["/dashboard","Dashboard"],["/domains/search","Search domains"],["/domains/my","My domains"],["/notifications","Notifications"],["/account","Account"],["/support","Support"]];
  const current = location.pathname;
  return `<aside class="sidebar"><div class="sidebar-section">${admin ? "Registry administration" : "Workspace"}</div>${links.map(([route, label]) => `<a class="side-link ${current === route ? "active" : ""}" href="${route}" data-route>${label}</a>`).join("")}<div class="sidebar-section">Public</div><a class="side-link" href="/" data-route>Public website</a></aside>`;
}

function appLayout(content, admin = false) { return `<div class="shell">${header()}<div class="app-layout">${sideNav(admin)}<main class="main">${content}</main></div></div>`; }

function userDashboard(data) {
  const u = data.user;
  const slots = Math.max(0, Number(u.max_domains) - Number(u.current_domain_count));
  return appLayout(`<div class="main-title"><div><div class="eyebrow">Account workspace</div><h2>Good to see you, ${esc(u.full_name.split(" ")[0])}.</h2><p>Manage your experimental .etc namespace.</p></div><a href="/domains/search" class="button primary" data-route>Register a domain</a></div>
    ${u.status !== "ACTIVE" ? `<div class="notice" style="margin-bottom:18px"><strong>Account status: ${esc(u.status)}</strong><br/>Your account must be ACTIVE and approved before you can register domains.</div>` : ""}
    <div class="grid four"><div class="card metric"><div class="metric-label">Account status</div><div class="metric-value" style="font-size:23px"><span class="status-dot ${statusClass(u.status)}">${esc(u.status)}</span></div><div class="metric-sub">Approval state</div></div><div class="card metric"><div class="metric-label">UID</div><div class="metric-value mono" style="font-size:18px">${esc(u.uid)}</div><div class="metric-sub">Permanent identifier</div></div><div class="card metric"><div class="metric-label">Domains</div><div class="metric-value">${u.current_domain_count} / ${u.max_domains}</div><div class="metric-sub">Registered names</div></div><div class="card metric"><div class="metric-label">Available slots</div><div class="metric-value">${slots}</div><div class="metric-sub">Based on current limit</div></div></div>
    <div class="split section"><div class="card"><div class="section-head"><div><h3>Recent activity</h3><p>Important account and registry events.</p></div></div><div class="list">${data.activity.length ? data.activity.map(a => `<div class="list-item"><div><strong>${esc(a.action)}</strong><small>${esc(a.target)} · ${fmtDate(a.timestamp)}</small></div><span class="badge">${esc(a.action)}</span></div>`).join("") : `<div class="empty">No activity yet.</div>`}</div></div><div class="card"><div class="section-head"><div><h3>Notifications</h3><p>Updates from RC Domain.</p></div><a href="/notifications" data-route class="hint">View all</a></div><div class="list">${data.notifications.length ? data.notifications.slice(0,5).map(n => `<div class="list-item"><div><strong>${esc(n.title)}</strong><small>${esc(n.body)}</small></div><small>${fmtDate(n.created_at)}</small></div>`).join("") : `<div class="empty">No notifications.</div>`}</div></div></div>`, false);
}

function adminDashboard(data) {
  const m = data.metrics;
  return appLayout(`<div class="main-title"><div><div class="eyebrow">Registry administration</div><h2>Control center</h2><p>Review the registry, account approvals, and system health.</p></div><a href="/admin/system" class="button secondary" data-route>System status</a></div>
    <div class="grid four"><div class="card metric"><div class="metric-label">Total users</div><div class="metric-value">${m.totalUsers}</div><div class="metric-sub">${m.pendingUsers} pending approval</div></div><div class="card metric"><div class="metric-label">Active users</div><div class="metric-value">${m.activeUsers}</div><div class="metric-sub">${m.suspendedUsers} suspended</div></div><div class="card metric"><div class="metric-label">Total domains</div><div class="metric-value">${m.totalDomains}</div><div class="metric-sub">${m.activeDomains} active</div></div><div class="card metric"><div class="metric-label">API health</div><div class="metric-value" style="font-size:22px"><span class="status-dot online">ONLINE</span></div><div class="metric-sub">SQLite + registry foundation</div></div></div>
    <div class="split section"><div class="card"><div class="section-head"><div><h3>Recent registrations</h3><p>Latest names in the registry.</p></div><a href="/admin/domains" class="hint" data-route>All domains</a></div><div class="list">${data.recentRegistrations.length ? data.recentRegistrations.map(d => `<div class="list-item"><div><strong class="mono">${esc(d.domain)}</strong><small>${esc(d.username || "Reserved")} · ${fmtDate(d.registered_at)}</small></div><span class="badge ${statusClass(d.status)}">${esc(d.status)}</span></div>`).join("") : `<div class="empty">No registrations yet.</div>`}</div></div><div class="card"><div class="section-head"><div><h3>Recent admin actions</h3><p>Immutable operational trail.</p></div><a href="/admin/audit" class="hint" data-route>Full audit</a></div><div class="list">${data.recentActions.map(a => `<div class="list-item"><div><strong>${esc(a.action)}</strong><small>${esc(a.target)} · ${fmtDate(a.timestamp)}</small></div></div>`).join("") || `<div class="empty">No actions yet.</div>`}</div></div></div>`, true);
}

function searchPage() {
  return publicLayout(`<div class="page"><div class="main-title"><div><div class="eyebrow">Domain search</div><h2>Find your .etc name.</h2><p>Search the private testing registry before you register.</p></div></div><div class="card"><form id="domain-search" class="search-row"><input class="input" name="name" value="${esc(state.query)}" placeholder="e.g. raja" required /><button class="button primary">Search availability</button></form><div id="search-result" style="margin-top:20px">${state.search ? searchResult(state.search) : `<div class="empty">Enter a label to check availability.</div>`}</div></div><div class="section grid three"><div class="card"><h3>Available</h3><p>A name can be registered when your account is active and within its assigned limit.</p></div><div class="card"><h3>Reserved</h3><p>System names such as rc.etc are held by RC Domain and cannot be registered.</p></div><div class="card"><h3>TEST/PRIVATE</h3><p>.etc is not an officially delegated global DNS extension in this prototype.</p></div></div></div>`);
}

function registerDomainPage() {
  const requested = new URLSearchParams(location.search).get("name") || "";
  return appLayout(`<div class="main-title"><div><div class="eyebrow">Domain registration</div><h2>Register a .etc name.</h2><p>The API will re-check approval, status, syntax, availability, reservations, and your domain limit.</p></div></div><div class="split"><div class="card"><h3>Registration details</h3><form id="register-domain-form" class="form" style="margin-top:18px"><div class="field"><label>Domain label</label><div class="search-row" style="margin-top:0"><input class="input" name="domain" value="${esc(requested)}" placeholder="your-name" required /><span class="button secondary" style="pointer-events:none">.etc</span></div></div><button class="button primary">Register domain</button></form><div id="domain-register-message" style="margin-top:14px"></div></div><div class="card"><h3>Before you register</h3><div class="list"><div class="list-item"><div><strong>Active account</strong><small>Your account must be approved and ACTIVE.</small></div></div><div class="list-item"><div><strong>Available name</strong><small>Reserved, registered, and suspended names cannot be claimed.</small></div></div><div class="list-item"><div><strong>Private testing</strong><small>.etc is TEST/PRIVATE and not globally delegated.</small></div></div></div></div></div>`, false);
}

function searchResult(result) {
  const cls = statusClass(result.status);
  return `<div class="card" style="background:#0b1020"><div class="list-item"><div><div class="eyebrow">Result</div><h3 class="mono" style="margin-top:8px">${esc(result.domain)}</h3>${result.reason ? `<p style="margin:7px 0 0">Reason: ${esc(result.reason)}</p>` : ""}</div><div style="text-align:right"><span class="badge ${cls}">${esc(result.status)}</span>${result.status === "AVAILABLE" ? `<div style="margin-top:12px"><a class="button primary small" href="/domains/register?name=${encodeURIComponent(result.label)}" data-route>Register</a></div>` : ""}</div></div></div>`;
}

function domainsPage(domains = []) {
  return appLayout(`<div class="main-title"><div><div class="eyebrow">Registry</div><h2>My domains</h2><p>Names owned by your account.</p></div><a href="/domains/search" class="button primary" data-route>Find a name</a></div><div class="table-wrap"><table class="table"><thead><tr><th>Domain</th><th>Status</th><th>DNS</th><th>Registered</th><th></th></tr></thead><tbody>${domains.length ? domains.map(d => `<tr><td class="mono">${esc(d.domain)}</td><td><span class="badge ${statusClass(d.status)}">${esc(d.status)}</span></td><td>${esc(d.dns_status)}</td><td>${fmtDate(d.registered_at)}</td><td><a href="/domains/${encodeURIComponent(d.domain)}" class="button secondary small" data-route>Manage</a></td></tr>`).join("") : `<tr><td colspan="5"><div class="empty">No domains yet. Search for an available .etc name to begin.</div></td></tr>`}</tbody></table></div>`, false);
}

function adminUsers(users = []) {
  return appLayout(`<div class="main-title"><div><div class="eyebrow">People</div><h2>User management</h2><p>Approve accounts, manage statuses, and assign domain limits.</p></div></div><form id="user-filter" class="toolbar"><input class="input" name="search" placeholder="Search UID, email, username, name" value="${esc(new URLSearchParams(location.search).get("search") || "")}" /><select class="select" name="status"><option>ALL</option><option>PENDING</option><option>ACTIVE</option><option>DEACTIVATED</option><option>SUSPENDED</option></select><button class="button secondary">Filter</button></form><div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>UID</th><th>Status</th><th>Domains</th><th>Registered</th><th></th></tr></thead><tbody>${users.length ? users.map(u => `<tr><td><strong>${esc(u.full_name)}</strong><small class="hint">${esc(u.email)}</small></td><td class="mono">${esc(u.uid)} <button class="button ghost small" data-copy="${esc(u.uid)}">Copy</button></td><td><span class="badge ${statusClass(u.status)}">${esc(u.status)}</span></td><td>${u.current_domain_count} / ${u.max_domains}</td><td>${fmtDate(u.created_at)}</td><td><a href="/admin/users/${esc(u.uid)}" class="button secondary small" data-route>Open</a></td></tr>`).join("") : `<tr><td colspan="6"><div class="empty">No users match this filter.</div></td></tr>`}</tbody></table></div>`, true);
}

function adminDomains(domains = []) {
  return appLayout(`<div class="main-title"><div><div class="eyebrow">Registry</div><h2>Domain management</h2><p>Review ownership and moderate registry status.</p></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Domain</th><th>Owner</th><th>Status</th><th>DNS</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${domains.map(d => `<tr><td class="mono">${esc(d.domain)}</td><td>${esc(d.full_name || "Reserved")}<small class="hint">${esc(d.email || "RC Domain")}</small></td><td><span class="badge ${statusClass(d.status)}">${esc(d.status)}</span></td><td>${esc(d.dns_status)}</td><td>${fmtDate(d.updated_at)}</td><td><button class="button secondary small" data-domain-action="${esc(d.domain)}" data-status="ACTIVE">Activate</button> <button class="button danger small" data-domain-action="${esc(d.domain)}" data-status="SUSPENDED">Suspend</button></td></tr>`).join("") || `<tr><td colspan="6"><div class="empty">No domains have been registered.</div></td></tr>`}</tbody></table></div>`, true);
}

function simplePage(title, body, admin = false) {
  return admin ? appLayout(`<div class="main-title"><div><div class="eyebrow">RC Domain</div><h2>${title}</h2></div></div>${body}`, true) : publicLayout(`<div class="page"><div class="main-title"><div><div class="eyebrow">RC Domain</div><h2>${title}</h2></div></div>${body}</div>`);
}

async function loadUser() {
  try { state.user = (await api("/auth/me")).user; } catch (_) { state.user = null; }
}

async function render() {
  const route = location.pathname;
  if (route === "/login") { app.innerHTML = authPage("login"); return; }
  if (route === "/admin/login") { app.innerHTML = authPage("admin"); return; }
  if (route === "/register") { app.innerHTML = authPage("register"); return; }
  if (route === "/admin/setup") { app.innerHTML = authPage("setup"); return; }
  if (route === "/" || route === "") { app.innerHTML = home(); return; }
  if (route === "/domains") { app.innerHTML = searchPage(); return; }
  if (route === "/domains/search") { app.innerHTML = searchPage(); return; }
  if (route === "/domains/register") { app.innerHTML = registerDomainPage(); return; }
  if (route === "/domain-rules") { app.innerHTML = simplePage("Domain rules", `<div class="card"><h3>Experimental registry rules</h3><p>Use names responsibly. RC Domain may reserve or suspend names that violate the testing policy. Account approval is required, and every status or DNS change is recorded in the audit log.</p><div class="notice">The .etc extension is private/test-only in this prototype and is not an officially delegated global DNS TLD.</div></div>`); return; }
  if (["/terms", "/privacy", "/forgot-password", "/security"].includes(route)) { app.innerHTML = simplePage(route === "/terms" ? "Terms of testing" : route === "/privacy" ? "Privacy" : route === "/security" ? "Security" : "Password recovery", `<div class="card"><h3>${route === "/forgot-password" ? "Password recovery is not enabled yet" : "Prototype policy"}</h3><p>${route === "/forgot-password" ? "For this local prototype, contact the administrator and never share your password. A production email recovery flow is a planned extension." : "RC Domain stores secure password hashes, uses session cookies, records administrative actions, and clearly labels .etc as TEST/PRIVATE. Do not share credentials or expose the database through a public tunnel."}</p></div>`); return; }
  if (route === "/system-status") { app.innerHTML = simplePage("System status", `<div class="grid three"><div class="card"><span class="status-dot online">ONLINE</span><h3 style="margin-top:18px">Website</h3><p>Public web interface is available.</p></div><div class="card"><span class="status-dot online">ONLINE</span><h3 style="margin-top:18px">API</h3><p>REST API is available for the future Android client.</p></div><div class="card"><span class="status-dot warning">WARNING</span><h3 style="margin-top:18px">DNS</h3><p>TEST/PRIVATE foundation only; no global .etc resolution claim.</p></div></div>`); return; }
  if (!state.user) { go("/login"); return; }
  if (route === "/dashboard") { app.innerHTML = `<div class="loading">Loading dashboard…</div>`; const dashboard = await api("/dashboard"); app.innerHTML = userDashboard(dashboard); return; }
  if (route === "/domains/my") { app.innerHTML = domainsPage((await api("/domains")).domains); return; }
  if (route === "/notifications") { const ns = (await api("/notifications")).notifications; app.innerHTML = appLayout(`<div class="main-title"><div><div class="eyebrow">Updates</div><h2>Notifications</h2><p>Useful details about changes to your account and domains.</p></div></div><div class="card"><div class="list">${ns.map(n => `<div class="list-item"><div><strong>${esc(n.title)}</strong><small>${esc(n.body)}</small></div><small>${fmtDate(n.created_at)}</small></div>`).join("") || `<div class="empty">No notifications yet.</div>`}</div></div>`, false); return; }
  if (route === "/account") { app.innerHTML = simplePage("Account", `<div class="card"><div class="list"><div class="list-item"><div><strong>Full name</strong><small>${esc(state.user.full_name)}</small></div></div><div class="list-item"><div><strong>Username</strong><small>${esc(state.user.username)}</small></div></div><div class="list-item"><div><strong>Email</strong><small>${esc(state.user.email)}</small></div></div><div class="list-item"><div><strong>UID</strong><small class="mono">${esc(state.user.uid)}</small></div></div></div></div>`); return; }
  if (route === "/support") { app.innerHTML = simplePage("Support", `<div class="card"><h3>Testing support</h3><p>For this prototype, contact the administrator with your UID and a clear description of the issue. Do not send passwords or session cookies.</p></div>`); return; }
  if (route.startsWith("/domains/") && route !== "/domains/search") { const domain = decodeURIComponent(route.split("/")[2]); const data = await api(`/domains/${encodeURIComponent(domain)}`); app.innerHTML = appLayout(`<div class="main-title"><div><div class="eyebrow">Domain management</div><h2 class="mono">${esc(data.domain.domain)}</h2><p>Status: <span class="badge ${statusClass(data.domain.status)}">${esc(data.domain.status)}</span> · ${esc(data.domain.dns_status)}</p></div><a class="button secondary" href="/domains/my" data-route>Back to domains</a></div><div class="split"><div class="card"><h3>Domain details</h3><div class="list"><div class="list-item"><div><strong>Registered</strong><small>${fmtDate(data.domain.registered_at)}</small></div></div><div class="list-item"><div><strong>Last updated</strong><small>${fmtDate(data.domain.updated_at)}</small></div></div>${data.domain.suspension_reason ? `<div class="notice">Suspension reason: ${esc(data.domain.suspension_reason)}</div>` : ""}</div></div><div class="card"><h3>DNS records</h3><p>TEST/PRIVATE registry foundation. Add records only for testing.</p><form id="dns-form" class="form"><input class="input" name="name" placeholder="www" required /><select class="select" name="type"><option>A</option><option>AAAA</option><option>CNAME</option><option>MX</option><option>TXT</option><option>NS</option></select><input class="input" name="value" placeholder="203.0.113.10" required /><input class="input" name="ttl" type="number" value="3600" min="60" max="86400" required /><button class="button primary">Add DNS record</button></form><div class="list" style="margin-top:22px">${data.dnsRecords.map(r => `<div class="list-item"><div><strong>${esc(r.name)} · ${esc(r.type)}</strong><small class="mono">${esc(r.value)} · TTL ${r.ttl}</small></div><button class="button danger small" data-delete-dns="${esc(r.id)}">Delete</button></div>`).join("") || `<div class="empty">No records yet.</div>`}</div></div></div>`, false); return; }
  if (route === "/admin" && state.user.role === "ADMIN") { app.innerHTML = adminDashboard((await api("/admin/overview"))); return; }
  if (route === "/admin/users") { app.innerHTML = adminUsers((await api(`/admin/users${location.search}`)).users); return; }
  if (route.startsWith("/admin/users/")) { const uid = route.split("/")[3]; const d = await api(`/admin/users/${uid}`); app.innerHTML = appLayout(`<div class="main-title"><div><div class="eyebrow">User detail</div><h2>${esc(d.user.full_name)}</h2><p class="mono">${esc(d.user.uid)} · ${esc(d.user.email)}</p></div><a href="/admin/users" class="button secondary" data-route>Back to users</a></div><div class="split"><div class="card"><h3>Account controls</h3><div class="list"><div class="list-item"><div><strong>Status</strong><small><span class="badge ${statusClass(d.user.status)}">${esc(d.user.status)}</span></small></div></div><div class="list-item"><div><strong>Domains</strong><small>${d.user.current_domain_count} / ${d.user.max_domains}</small></div></div><div class="list-item"><div><strong>Created</strong><small>${fmtDate(d.user.created_at)}</small></div></div></div><div class="actions" style="margin-top:20px"><button class="button primary" data-user-status="${uid}" data-status="ACTIVE">Activate</button><button class="button secondary" data-user-status="${uid}" data-status="DEACTIVATED">Deactivate</button><button class="button danger" data-user-status="${uid}" data-status="SUSPENDED">Suspend</button></div></div><div class="card"><h3>Domain limit</h3><p>Existing domains are never deleted when a limit is lowered.</p><form id="limit-form" class="search-row"><input class="input" name="maximum" type="number" min="0" max="10000" value="${d.user.max_domains}" /><button class="button secondary">Save limit</button></form><h3 style="margin-top:30px">User domains</h3><div class="list">${d.domains.map(x => `<div class="list-item"><strong class="mono">${esc(x.domain)}</strong><span class="badge ${statusClass(x.status)}">${esc(x.status)}</span></div>`).join("") || `<div class="empty">No domains.</div>`}</div></div></div>`, true); return; }
  if (route === "/admin/domains") { app.innerHTML = adminDomains((await api("/admin/domains")).domains); return; }
  if (route === "/admin/vip") { app.innerHTML = simplePage("VIP / domain limits", `<div class="card"><h3>Domain limits live in user details</h3><p>Search a user in <a href="/admin/users" data-route style="color:#aab7ff">User management</a>, then assign 0–10000 domains. Lowering a limit never deletes existing names.</p></div>`, true); return; }
  if (route === "/admin/audit") { const logs = (await api("/admin/audit")).logs; app.innerHTML = simplePage("Audit logs", `<div class="table-wrap"><table class="table"><thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>Timestamp</th><th>Details</th></tr></thead><tbody>${logs.map(l => `<tr><td>${esc(l.action)}</td><td class="mono">${esc(l.actor_uid)}</td><td>${esc(l.target)}</td><td>${fmtDate(l.timestamp)}</td><td class="hint">${esc(l.details)}</td></tr>`).join("") || `<tr><td colspan="5"><div class="empty">No audit entries.</div></td></tr>`}</tbody></table></div>`, true); return; }
  if (route === "/admin/system") { const d = await api("/admin/system"); app.innerHTML = simplePage("System status", `<div class="grid three">${d.services.map(s => `<div class="card"><span class="status-dot ${s.status.toLowerCase()}">${esc(s.status)}</span><h3 style="margin-top:17px">${esc(s.name)}</h3><p class="mono" style="font-size:11px;word-break:break-word">${esc(s.detail)}</p></div>`).join("")}</div><div class="card section"><h3>Public configuration</h3><div class="list">${Object.entries(d.configuration).map(([k,v]) => `<div class="list-item"><strong>${esc(k)}</strong><span class="mono hint">${esc(v)}</span></div>`).join("")}</div></div>`, true); return; }
  app.innerHTML = simplePage("Page not found", `<div class="card"><p>The requested route does not exist.</p><a class="button primary" href="/" data-route>Return home</a></div>`);
}

document.addEventListener("click", async event => {
  const routeLink = event.target.closest("[data-route]");
  if (routeLink) { event.preventDefault(); sound("click"); go(routeLink.getAttribute("href")); return; }
  const copy = event.target.closest("[data-copy]");
  if (copy) { await navigator.clipboard?.writeText(copy.dataset.copy); toast("Copied successfully."); return; }
  if (event.target.closest("[data-action='logout']")) { try { await api("/auth/logout", { method: "POST" }); state.user = null; toast("Logged out."); go("/"); } catch (e) { toast(e.message, "error"); } return; }
  const userAction = event.target.closest("[data-user-status]");
  if (userAction) {
    const status = userAction.dataset.status;
    const reason = status === "ACTIVE" ? prompt("Optional activation note:") || "" : prompt(`Reason to ${status.toLowerCase()} this user (required):`) || "";
    if ((status === "SUSPENDED" || status === "DEACTIVATED") && !reason.trim()) return toast("A reason is required.", "error");
    try { await api(`/admin/users/${userAction.dataset.userStatus}/status`, { method: "POST", body: JSON.stringify({ status, reason }) }); toast("User status updated."); render(); } catch (e) { toast(e.message, "error"); }
  }
  const domainAction = event.target.closest("[data-domain-action]");
  if (domainAction) {
    const status = domainAction.dataset.status;
    const reason = status === "SUSPENDED" ? prompt("Suspension reason (required):") || "" : "";
    if (status === "SUSPENDED" && !reason.trim()) return toast("A reason is required.", "error");
    try { await api(`/admin/domains/${encodeURIComponent(domainAction.dataset.domain)}/status`, { method: "POST", body: JSON.stringify({ status, reason }) }); toast("Domain status updated."); render(); } catch (e) { toast(e.message, "error"); }
  }
  const deleteDns = event.target.closest("[data-delete-dns]");
  if (deleteDns && confirm("Delete this DNS record?")) {
    const domain = decodeURIComponent(location.pathname.split("/")[2]);
    try { await api(`/domains/${encodeURIComponent(domain)}/dns/${deleteDns.dataset.deleteDns}`, { method: "DELETE" }); toast("DNS record deleted."); render(); } catch (e) { toast(e.message, "error"); }
  }
});

document.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    if (form.id === "quick-search" || form.id === "domain-search") {
      state.query = data.name; state.search = await api(`/domains/search?name=${encodeURIComponent(data.name)}`).then(x => x.result);
      if (form.id === "quick-search") { const out = document.getElementById("quick-result"); out.innerHTML = searchResult(state.search); } else render();
    } else if (form.id === "register-form") {
      const result = await api("/auth/register", { method: "POST", body: JSON.stringify(data) }); document.getElementById("form-message").innerHTML = `<div class="alert success">${esc(result.message)} Your UID is <strong>${esc(result.uid)}</strong>.</div>`; form.reset();
    } else if (form.id === "setup-form") {
      await api("/setup/admin", { method: "POST", body: JSON.stringify(data) }); toast("Administrator created."); go("/admin/login");
    } else if (form.id === "login-form") {
      const admin = location.pathname === "/admin/login"; const result = await api(admin ? "/admin/login" : "/auth/login", { method: "POST", body: JSON.stringify(data) }); state.user = result.user; toast("Welcome back."); go(admin ? "/admin" : "/dashboard");
    } else if (form.id === "dns-form") {
      const domain = decodeURIComponent(location.pathname.split("/")[2]); await api(`/domains/${encodeURIComponent(domain)}/dns`, { method: "POST", body: JSON.stringify(data) }); toast("DNS record added."); render();
    } else if (form.id === "register-domain-form") {
      const result = await api("/domains", { method: "POST", body: JSON.stringify({ domain: data.domain }) }); document.getElementById("domain-register-message").innerHTML = `<div class="alert success">${esc(result.message)}</div>`; form.reset(); sound("success");
    } else if (form.id === "limit-form") {
      const uid = location.pathname.split("/")[3]; await api(`/admin/users/${uid}/limit`, { method: "POST", body: JSON.stringify({ maximum: Number(data.maximum) }) }); toast("Domain limit updated."); render();
    } else if (form.id === "user-filter") {
      const params = new URLSearchParams({ search: data.search || "", status: data.status || "ALL" }); go(`/admin/users?${params}`);
    }
  } catch (error) {
    const target = document.getElementById("form-message");
    if (target) target.innerHTML = `<div class="alert error">${esc(error.message)}</div>`; else toast(error.message, "error");
    sound("error");
  }
});

window.addEventListener("popstate", render);
(async function start() {
  try { const setup = await fetch("/api/setup/status").then(r => r.json()); state.setup = setup.setupRequired; state.setupEnabled = setup.enabled; } catch (_) {}
  await loadUser();
  if (state.setup && state.setupEnabled && ["/login", "/"].includes(location.pathname)) {
    // The public site remains open; the setup entry point is intentionally explicit.
  }
  render();
})();
