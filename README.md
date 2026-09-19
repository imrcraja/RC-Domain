# RC Domain

RC Domain is a runnable, professional domain-registry prototype for public
Internet testing. The first extension is `.etc`, and it is explicitly a
private/experimental testing extension — **not an officially delegated public
DNS TLD**. The project is designed to run from Android Termux now and move to
an Ubuntu 24.04 VPS later without a major rewrite.

## Final architecture

```text
Public HTTPS tunnel / reverse proxy
              |
       frontend/ (responsive SPA)
              |
       backend/server.js (REST API)
          /             \
 database/ (SQLite)   dns/ (TEST/PRIVATE foundation)
              |
       audit logs + notifications
```

The API is the single source of truth for authentication, user approval,
domain limits, domains, DNS records, notifications, and admin operations. The
frontend never contains admin credentials or business-rule enforcement.

## Technology choices

- Node.js 18+ and Express 4
- Vanilla JavaScript frontend with no build step, optimized for Termux
- `sql.js` SQLite-compatible persistence (portable schema and no native SQLite
  compilation required on Android)
- `bcryptjs` password hashing
- HTTP-only sessions, CSRF header protection, Helmet, CORS, rate limiting
- Web Audio API for small success/error interaction sounds; no external audio
  files or tracking

## Folder structure

```text
rc-domain/
├── frontend/
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── backend/
│   └── server.js
├── database/
│   └── README.md
├── dns/
│   └── README.md
├── docs/
│   └── API.md
├── scripts/
│   └── init-db.js
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Database schema

The API creates these tables automatically on the first start:

- `users`: UID, identity, secure password hash, status, role, limits
- `domains`: name, owner, status, moderation reason, DNS status
- `dns_records`: A, AAAA, CNAME, MX, TXT, and NS records
- `domain_status_history`, `user_status_history`
- `admin_actions`, `audit_logs`
- `sessions`: hashed session tokens and CSRF token
- `notifications`
- `system_settings`

There is no plaintext password storage. The first-run admin wizard never
hard-codes credentials and disables itself once an admin exists.

## API route list

### Public

`GET /api/health`, `GET /api/public/config`, `GET /api/setup/status`,
`POST /api/setup/admin`, `POST /api/auth/register`, `POST /api/auth/login`,
`POST /api/admin/login`, `GET /api/domains/search?name=raja`

### User

`GET /api/auth/me`, `POST /api/auth/logout`, `GET /api/dashboard`,
`GET /api/notifications`, `GET /api/domains`, `POST /api/domains`,
`GET /api/domains/:domain`, `POST /api/domains/:domain/dns`,
`PUT /api/domains/:domain/dns/:id`, `DELETE /api/domains/:domain/dns/:id`

### Admin

`GET /api/admin/overview`, `GET /api/admin/users`,
`GET /api/admin/users/:uid`, `POST /api/admin/users/:uid/status`,
`POST /api/admin/users/:uid/limit`, `GET /api/admin/domains`,
`POST /api/admin/domains/:domain/status`, `GET /api/admin/audit`,
`GET /api/admin/system`

Full request/response examples are in [`docs/API.md`](docs/API.md).

## Android Termux setup

These commands are copy-paste friendly. The project does not require Docker.

```bash
pkg update -y
pkg install -y nodejs-lts git curl
node --version
npm --version

cd ~/rc-domain
cp .env.example .env
npm install
```

Edit `.env`:

```bash
APP_BASE_URL=http://127.0.0.1:3000
API_BASE_URL=http://127.0.0.1:3000/api
DATABASE_URL=./database/rc-domain.sqlite
SESSION_SECRET=replace-this-with-a-long-random-value
ADMIN_SETUP_ENABLED=true
CORS_ORIGIN=http://127.0.0.1:3000
COOKIE_SECURE=false
```

Start the service on all interfaces:

```bash
npm start
```

Check the API:

```bash
curl http://127.0.0.1:3000/api/health
```

Open `http://127.0.0.1:3000/admin/setup` from the phone browser and create the
first administrator. Then use `/admin/login`. New public registrations appear
as `PENDING`; approve them in **Admin → Users** before registering a domain.

### Public HTTPS testing

Use any trusted HTTPS tunnel that supports forwarding to local port `3000`.
For example, with a tunnel client already installed and authenticated:

```bash
# Example shape; use the tunnel provider's current Termux command.
<tunnel-command> http 3000
```

Then update `.env` with the HTTPS URL supplied by the tunnel:

```bash
APP_BASE_URL=https://PUBLIC_TEST_URL
API_BASE_URL=https://PUBLIC_TEST_URL/api
CORS_ORIGIN=https://PUBLIC_TEST_URL
COOKIE_SECURE=true
```

Stop and restart the service:

```bash
# In the running terminal:
Ctrl-C
npm start
```

Give the tester `https://PUBLIC_TEST_URL`. The tunnel is for testing only; it
is not final production hosting. Do not expose `database/`, SQLite files, or
any database administration interface through the tunnel.

### Troubleshooting

- `EADDRINUSE`: stop the old Node process with `pkill -f "node backend/server.js"`
  or choose another `PORT`.
- Cookie/login problems behind HTTPS: set `APP_BASE_URL` and `CORS_ORIGIN` to
  the exact HTTPS URL and set `COOKIE_SECURE=true`.
- Health check fails: run `node --version`, `npm install`, then inspect the
  terminal output from `npm start`.
- To reset a local test registry, stop Node and remove
  `database/rc-domain.sqlite`. This deletes all local accounts, domains, and
  audit history.

## Public testing checklist

1. Start RC Domain from Termux.
2. Start the backend with `npm start`.
3. Open `/api/health`.
4. Expose port 3000 through a public HTTPS tunnel.
5. Open the HTTPS URL from another country.
6. Create a test user at `/register`.
7. Log in to `/login` and verify the pending dashboard.
8. Log in to `/admin/login`.
9. Approve the user in Admin → Users.
10. Set maximum domain limit to `2`.
11. Register the first `.etc` domain.
12. Register the second `.etc` domain.
13. Confirm the third registration returns `DOMAIN_LIMIT_REACHED` with current
    and maximum values.
14. Increase the limit to `3`.
15. Register the third domain.
16. Suspend it with a mandatory reason.
17. Confirm the user sees the suspension reason.
18. Activate the domain again.
19. Review Admin → Audit logs for every important action.

## Ubuntu 24.04 VPS migration

1. Install Node.js 18+ and copy the project.
2. Run `npm ci` and set production environment variables.
3. Keep SQLite for a small first deployment or migrate the portable schema and
   parameterized queries to PostgreSQL.
4. Put Nginx or Caddy in front of Node, terminate HTTPS, and forward the
   original host/protocol headers.
5. Set `APP_BASE_URL`, `API_BASE_URL`, `CORS_ORIGIN`, and `COOKIE_SECURE=true`.
6. Run Node under systemd or another process manager.
7. Keep the database on private storage, restrict firewall ports to 80/443 and
   SSH, and schedule encrypted backups.
8. Deploy an authoritative DNS service separately; keep the current
   TEST/PRIVATE label until `.etc` is actually configured for a controlled DNS
   environment.

The application already calls `app.set("trust proxy", 1)`, uses configurable
public URLs, and separates registry/DNS configuration so this migration does
not require a frontend rewrite.