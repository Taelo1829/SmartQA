# Setup

This document covers a working local installation, optional production adapters, and verification commands. All commands are run from the monorepo root with npm (the scripts in `package.json` are npm scripts).

- [1. Prerequisites](#1-prerequisites)
- [2. Local zero-infrastructure setup](#2-local-zero-infrastructure-setup)
- [3. Browser setup](#3-browser-setup)
- [4. Run the platform](#4-run-the-platform)
- [5. Configuration reference](#5-configuration-reference)
- [6. PostgreSQL and Redis mode](#6-postgresql-and-redis-mode)
- [7. Evidence and object storage](#7-evidence-and-object-storage)
- [8. Verification](#8-verification)
- [9. Troubleshooting](#9-troubleshooting)

## 1. Prerequisites

| Requirement | Notes |
| --- | --- |
| Node.js `>=20.9.0` | Declared in the root `package.json`. |
| npm | Use the root scripts (`npm run …`). |
| Playwright Chromium | Installed with `npx playwright install chromium`, or an existing Chrome/Edge channel. |
| PostgreSQL | Optional; only for `STORAGE_DRIVER=postgres`. |
| Redis | Optional; only for `QUEUE_DRIVER=redis` / BullMQ. |

No Docker image or compose file is configured in this repository. Start each process with the npm scripts below.

## 2. Local zero-infrastructure setup

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npx playwright install chromium
npm run dev
```

On macOS/Linux:

```bash
cp .env.example .env
npm install
npx playwright install chromium
npm run dev
```

`npm run dev` starts the SmartQA web UI/API at <http://127.0.0.1:4101>.

Sign in with the bootstrap account on the first login attempt:

```text
Email:    qa@smartqa.local
Password: smartqa-demo-2026
```

These values come from `BOOTSTRAP_EMAIL` and `BOOTSTRAP_PASSWORD` in `.env.example`. Change them for any shared environment. Registration is also available through `/api/auth/register`; the bootstrap account is idempotently seeded when the configured bootstrap email signs in.

Local runtime state is written to `.data/` (ignored by Git): file-store collections, evidence under `.data/evidence`, and traces under `.data/traces`. Set `SMARTQA_DATA_DIR` to override that root.

### Private-network access

`.env.example` sets:

```dotenv
ALLOW_PRIVATE_NETWORKS=false
```

Set `ALLOW_PRIVATE_NETWORKS=true` only for sites you own or are explicitly authorized to test on loopback/private networks (for example a local dev server). It is off by default because SmartQA resolves DNS and validates every navigation and subresource against an SSRF policy; loopback, private, link-local, cloud-metadata, `.local`, and `.internal` targets are otherwise rejected.

Set this in the environment of the process that performs the run (the web app for live/inline runs, or the worker for dedicated background processing). For the Next.js web process, export it in the shell or put it in `apps/web/.env.local`, then restart.

Keep `ALLOW_DESTRUCTIVE_ACTIONS=false` unless data loss on the target account is acceptable.

## 3. Browser setup

Playwright uses its default cache unless configured otherwise. SmartQA also tries, in order:

1. `PLAYWRIGHT_CHANNEL` from the environment.
2. Bundled Playwright Chromium.
3. `chrome` channel.
4. `msedge` channel.
5. Executables under `PLAYWRIGHT_BROWSERS_PATH`, `%LOCALAPPDATA%\ms-playwright`, and `~/.cache/ms-playwright`.

To install into a repository-local folder on Windows:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.playwright'
npx playwright install chromium
```

Alternatively, put the absolute path in `.env`:

```dotenv
PLAYWRIGHT_BROWSERS_PATH=C:\Users\user\Documents\me\SmartQA\.playwright
```

The engine loads the root `.env` before importing Playwright specifically so this path is honoured.

Check what can actually launch:

```powershell
npx tsx scripts/browser-probe.ts
```

Live mode still uses a headless browser by default and streams screenshots over CDP. Set `PLAYWRIGHT_HEADLESS=false` only when you want a visible local window. `PLAYWRIGHT_CHANNEL=chrome` or `PLAYWRIGHT_CHANNEL=msedge` can be used when a bundled Chromium download is unavailable.

## 4. Run the platform

### Development

```powershell
npm run dev
```

With the default `QUEUE_DRIVER=local`, the web process starts an inline, database-backed queue consumer on the first background run. A separate worker is not required for the standard local setup.

To make a dedicated worker own local jobs instead, set `INLINE_WORKER=false` for the web process and run:

```powershell
npm run worker
```

The standalone worker is always required when `QUEUE_DRIVER=redis`, because the web app deliberately does not run an inline worker in Redis mode.

### Production-like local start

```powershell
npm run build
npm run start
npm run worker   # only for Redis mode, or local mode with INLINE_WORKER=false
```

For the web app alone:

```powershell
npm run start:web
```

The PDF exporter loads `${APP_URL}/runs/{id}/report?print=1` in Chromium. Keep `APP_URL` reachable from the web process; JSON export does not depend on this round trip.

## 5. Configuration reference

Copy `.env.example` to `.env`. The following variables are read by `packages/db/src/config.ts`.

### Canonical `.env.example` variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `STORAGE_DRIVER` | `file` | `file` uses the JSON store; `postgres` uses Prisma/PostgreSQL. |
| `DATABASE_URL` | local PostgreSQL URL | Required when `STORAGE_DRIVER=postgres`. |
| `QUEUE_DRIVER` | `local` | `local` is DB-backed and polled; `redis` uses BullMQ. |
| `REDIS_URL` | `redis://localhost:6379` | Required when `QUEUE_DRIVER=redis`. |
| `SESSION_ENCRYPTION_KEY` | development-only string | 32+ byte secret for AES-256-GCM session vault encryption. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `APP_URL` | `http://127.0.0.1:4101` | Public origin for links and PDF rendering. |
| `BOOTSTRAP_EMAIL` | `qa@smartqa.local` | First-login bootstrap account. |
| `BOOTSTRAP_PASSWORD` | `smartqa-demo-2026` | First-login bootstrap password. |
| `PLAYWRIGHT_CHANNEL` | empty | Optional Chromium channel such as `chrome` or `msedge`. |
| `PLAYWRIGHT_HEADLESS` | `true` | Launch Chromium headlessly. |
| `MAX_CONCURRENT_BROWSERS` | `2` | Browser concurrency setting; parsed with a minimum of 1, but not currently enforced by the engine. |
| `RUN_TIMEOUT_MS` | `600000` | Global run timeout in milliseconds. |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible chat-completions base URL. |
| `LLM_API_KEY` | empty | Empty disables all LLM calls. |
| `LLM_MODEL` | `gpt-4o-mini` | Model used for optional assistance. |
| `ALLOW_PRIVATE_NETWORKS` | `false` | Off by default; only enable for owned/local targets. |
| `ALLOW_DESTRUCTIVE_ACTIONS` | `false` | Off by default; blocks delete/pay/unsubscribe-style actions. |

> The comment at the top of `.env.example` notes enabling production adapters by setting `DATABASE_URL` / `REDIS_URL`. The code also requires the matching driver switches: set `STORAGE_DRIVER=postgres` and `QUEUE_DRIVER=redis` explicitly.

### Additional source-supported variables

These are read by the code but are not listed in `.env.example`:

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOOTSTRAP_NAME` | `QA Operator` | Display name for the bootstrap user. |
| `SESSION_TTL_DAYS` | `7` | Lifetime of encrypted, vaulted browser sessions. |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright/OS cache | Override the Chromium cache path. |
| `SMARTQA_DATA_DIR` | `<workspace>/.data` | Override file store, evidence, and traces directories. |
| `INLINE_WORKER` | enabled | Set `false` to keep the web process from polling the local queue. |
| `WORKER_CONCURRENCY` | `1` | BullMQ worker concurrency in `apps/worker`. |
| `NODE_ENV` | `development` | `production` enables secure cookies and requires a valid encryption secret. |

Rotating `SESSION_ENCRYPTION_KEY` invalidates previously captured sessions: the vault marks undecryptable entries as revoked rather than exposing plaintext.

## 6. PostgreSQL and Redis mode

1. Provision PostgreSQL and Redis, then edit `.env`:

   ```dotenv
   STORAGE_DRIVER=postgres
   DATABASE_URL=postgresql://smartqa:smartqa@localhost:5432/smartqa?schema=public
   QUEUE_DRIVER=redis
   REDIS_URL=redis://localhost:6379
   SESSION_ENCRYPTION_KEY=<32-or-more-character-production-secret>
   ALLOW_PRIVATE_NETWORKS=false
   ALLOW_DESTRUCTIVE_ACTIONS=false
   ```

2. Generate and apply the Prisma client/schema:

   ```powershell
   npm run db:generate
   npm run db:migrate
   ```

   `db:generate` runs `prisma generate`; `db:migrate` runs `prisma migrate dev`. For an existing production database, use your organization's migration deployment procedure rather than an interactive dev migration.

3. Start the web app and a standalone worker in separate terminals:

   ```powershell
   npm run build
   npm run start:web
   ```

   ```powershell
   npm run worker
   ```

The file store is single-process; PostgreSQL plus Redis/BullMQ is the supported path for multiple web or worker instances. Live sessions and run control handles remain process-local, so a live browser must stay attached to the process that created it. Background runs can be picked up by any worker.

## 7. Evidence and object storage

Evidence metadata lives in the store; binary objects live in an object store. The local `LocalObjectStore` writes to `.data/evidence` by default and is the only implemented adapter.

The `ObjectStore` interface is intentionally S3-shaped (`put`, `get`, `stat`, `delete`), but the S3/MinIO adapter in `packages/db/src/objectStore.ts` is a placeholder, not a working implementation. External object storage is therefore an extension point rather than a selectable configuration today. See [ARCHITECTURE.md](ARCHITECTURE.md#replacing-the-object-store) before adding an adapter.

Evidence is served only through authenticated routes such as `GET /api/runs/{id}/evidence/{evidenceId}`; object keys are server-generated and never user-controlled.

## 8. Verification

Run these from the repository root:

```powershell
npm run typecheck
npm test
npm run build
npm run smoke
npm run test:e2e
```

Vitest uses `tests/setup.ts`, which isolates each run with a temporary `SMARTQA_DATA_DIR`, a fixed test encryption key, `file`/`local` adapters, no LLM key, and private-network access enabled for browser tests.

The previously bundled demo app and demo-only end-to-end/API harness scripts have been removed. To validate behavior against a real target, start the web app, create a live or background run for a site you own or are authorized to test, and confirm progress, findings/evidence, and report export. The run form defaults to maximum budgets/viewports and provides a “Use max of everything” action to maximize coverage bounds. See [VERIFICATION.md](VERIFICATION.md) for details and known limitations.

## 9. Troubleshooting

| Symptom | Cause / action |
| --- | --- |
| `No Chromium browser could be launched` | Run `npx playwright install chromium`, set `PLAYWRIGHT_BROWSERS_PATH`, or set `PLAYWRIGHT_CHANNEL=chrome`. Re-run `npx tsx scripts/browser-probe.ts` to confirm. |
| `Blocked private-network address …` or `UNSAFE_URL` | The target resolves to loopback/private space. Only for a site you own, set `ALLOW_PRIVATE_NETWORKS=true` for the web/worker process and restart it. |
| `AUTH_REQUIRES_LIVE` | A background run requested authentication without a stored session. Start in Live mode, sign in manually, then continue or detach. |
| `SESSION_ENCRYPTION_KEY must be set to at least 32 characters` | Set a production-grade 32+ character secret in `.env` and restart. Captured sessions encrypted with the old key will be revoked. |
| PDF export returns `PDF_UNAVAILABLE` | Chromium could not render `APP_URL`. Check `APP_URL`, browser installation, and web availability. JSON export remains available. |
| Background jobs stay `queued` | With `QUEUE_DRIVER=local`, confirm the web process is allowed to host the inline worker (`INLINE_WORKER` is not `false`) or start `npm run worker`. With Redis, confirm `REDIS_URL` and that `npm run worker` is running. |
| Runs report `Mobile viewport was not tested` | Add `mobile` to the run's viewports. Note that the current orchestrator launches one context using the first selected viewport; see [ARCHITECTURE.md](ARCHITECTURE.md#known-incomplete-features). |
