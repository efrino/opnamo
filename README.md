# Opnamo

Stock-taking SaaS for small warehouses, shops and distributors: QR tags, phone scanning (offline-capable PWA), and variance reports in rupiah.

## Stack
- Node.js 22 + Express 5, PostgreSQL (multi-tenant by `company_id`)
- Vanilla JS PWA: camera scanning (BarcodeDetector, jsQR fallback), IndexedDB offline queue, service worker app shell
- ExcelJS for import/export

## Run locally
    docker run -d --name opn-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=opnamo -p 5432:5432 postgres:17-alpine
    npm install
    DATABASE_URL=postgres://postgres:test@localhost/opnamo npm start   # http://localhost:3000

## Test
    DATABASE_URL=postgres://postgres:test@localhost/opnamo npm test     # drops & recreates the schema!

## Environment
| Var | Meaning |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `DEMO` | `1` (default) seeds demo company `demo@opnamo.id` / `demo12345`, reset every 6 h; `0` disables |
| `PORT` | default 3000 |

Migrations in `src/migrations/*.sql` run automatically on start.

## Deploy
Coolify, Docker Compose build pack, domain `https://opnamo.efrino.web.id:3000`.
