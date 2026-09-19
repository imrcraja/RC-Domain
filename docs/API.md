# RC Domain API

The API is JSON REST and uses an HTTP-only `rc_session` cookie plus an
`rc_csrf` cookie. For every `POST`, `PUT`, or `DELETE`, send the same
`rc_csrf` value as the `x-csrf-token` header. All errors use:

```json
{
  "success": false,
  "error": { "code": "DOMAIN_LIMIT_REACHED", "message": "Human readable reason", "details": {} }
}
```

## Public

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Service health |
| GET | `/api/public/config` | Non-secret public configuration |
| GET | `/api/setup/status` | Whether first-run admin setup is needed |
| POST | `/api/setup/admin` | Create the first administrator once |
| POST | `/api/auth/register` | Create a pending user |
| POST | `/api/auth/login` | User login |
| POST | `/api/admin/login` | Admin login |
| GET | `/api/domains/search?name=raja` | Search `.etc` availability |

## Authenticated user

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/auth/me` | Current user |
| POST | `/api/auth/logout` | End session |
| GET | `/api/dashboard` | Dashboard metrics, notifications, activity |
| GET | `/api/domains` | Current user's domains |
| POST | `/api/domains` | Register a domain |
| GET | `/api/domains/:domain` | Domain and DNS records |
| POST | `/api/domains/:domain/dns` | Add DNS record |
| PUT | `/api/domains/:domain/dns/:id` | Edit DNS record |
| DELETE | `/api/domains/:domain/dns/:id` | Delete DNS record |

## Admin

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/admin/overview` | Registry dashboard metrics |
| GET | `/api/admin/users` | Search/filter users |
| GET | `/api/admin/users/:uid` | User details |
| POST | `/api/admin/users/:uid/status` | Activate/deactivate/suspend |
| POST | `/api/admin/users/:uid/limit` | Set maximum domains |
| GET | `/api/admin/domains` | All domains with owner data |
| POST | `/api/admin/domains/:domain/status` | Domain moderation |
| GET | `/api/admin/audit` | Audit log |
| GET | `/api/admin/system` | Configuration and service status |

Example registration:

```bash
curl -X POST "$API_BASE_URL/auth/register" \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"Raja","username":"raja","email":"raja@example.com","password":"change-this-password","confirmPassword":"change-this-password"}'
```
