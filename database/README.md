# Database

The Termux prototype stores its SQLite-compatible database at
`database/rc-domain.sqlite`. The application uses `sql.js` so the first
prototype does not require a native SQLite build. The schema is intentionally
portable to PostgreSQL: IDs and timestamps are explicit and business logic is
kept in the API layer.

Never expose this directory or a database admin port through a public tunnel.
