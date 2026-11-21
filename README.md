# SmartQA

SmartQA is a local-first, production-oriented website testing platform. It drives a real Chromium browser with Playwright, explores an application like a user, records deterministic evidence, and produces a report that separates confirmed defects from coverage gaps.

The platform is designed around four ideas:

- **Human-in-the-loop authentication** — a live run can pause at a login wall, let an operator sign in manually, encrypt the resulting browser storage state, and reuse it for later runs.
- **Live and background execution** — watch and take over a browser in real time, or queue a headless run for a worker.
- **Deterministic validation with AI assistance** — arithmetic, DOM signals, and assertions come from the page itself; an optional OpenAI-compatible model may only re-rank discovered actions, classify unfamiliar metrics, and draft an executive summary.
- **Honest reporting** — every run records checks, evidence, limitations, seed, budgets, and a coverage verdict. Sampling is never described as proof of correctness.

## What it can do

- Launch isolated Chromium contexts with Playwright at desktop (`1440×900`) or mobile (`390×844`) viewports.
- Discover pages and interactive elements from roles, native semantics, accessibility attributes, and visibility — not framework-specific class names.
- Exercise links, buttons, tabs, inputs, checkboxes, selects, pagination, and filters under explicit page/action/depth/time budgets.
- Detect runtime exceptions, console errors, failed requests, HTTP errors, broken images, invalid numeric tokens, missing content, stuck loading indicators, layout overflow, overlap, and arithmetic inconsistencies.
- Build a seeded state graph so runs can be replayed from the same exploration seed.
- Run filter campaigns covering baseline/reset probes, single options, all-options partitions, pairs, order permutations, triples, and sampled combinations.
- Replay high-confidence findings in a fresh browser context to classify them as reproducible, intermittent, or not reproduced.
- Store screenshots, traces, DOM dumps, metrics snapshots, and logs; serve evidence only through authenticated API routes.
- Export structured JSON reports and Chromium-printed PDF reports.

## Quick start (local, zero-infrastructure)

Requirements:

- Node.js `>=20.9.0` and npm.
- A Chromium binary that Playwright can launch.

From the repository root on Windows PowerShell:

```powershell
Copy-Item .env.example .env
npm install
npx playwright install chromium
npm run dev
```

Then open the SmartQA web UI at <http://127.0.0.1:4101>.

The default configuration uses a durable JSON file store under `.data/`, a database-backed local queue polled by an in-process worker, and local filesystem evidence storage. PostgreSQL, Redis/BullMQ, and external object storage are optional production seams; see [docs/SETUP.md](docs/SETUP.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

On first login, the bootstrap credentials from `.env.example` are seeded automatically:

```text
qa@smartqa.local
smartqa-demo-2026
```

Sign in, choose **New test**, enter a URL you own or are authorized to test, confirm authorization, and start a live or background run.

> `ALLOW_PRIVATE_NETWORKS` defaults to `false`. Enable it only when testing targets you own on localhost/private networks (for example a local dev server). Set it in the web app’s environment (export in the shell or `apps/web/.env.local`) and restart the web process. It is a deliberate SSRF guardrail, not a general setting to leave on.

## Verification status

| Check | Command | Notes |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | Pass (pre-removal baseline; re-run after changes). |
| Unit/integration tests | `npm test` | Pass (pre-removal baseline). |
| Production build | `npm run build` | Pass (pre-removal baseline). |
| Platform smoke test | `npm run smoke` | Pass (pre-removal baseline). |
| Synthetic browser E2E | `npm run test:e2e` | Browser capability suite (separate from the deleted demo-site harness). |

The bundled demo app and demo-only end-to-end/API harness scripts have been removed from this repository. To validate end-to-end behavior now, run the automated checks above and perform a manual live/background run against a site you own or are authorized to test (see [docs/VERIFICATION.md](docs/VERIFICATION.md)). Coverage is always sampled and budget-limited.

## Architecture at a glance

```text
Browser (Next.js UI)
   │  HTTPS / same-origin JSON
   ▼
apps/web (Next.js API routes)
   │  validate URL → create run → enqueue job
   ▼
packages/jobs (LocalQueue | BullQueue)
   │  run_test / reproduce_finding
   ▼
apps/worker or inline worker
   │
   ▼
packages/engine
   ├─ browser: Playwright Chromium + CDP screencast + signal collectors
   ├─ explore: seeded state graph, interactions, destructive-action policy
   ├─ validate: metrics, table totals, filter combinations
   ├─ detect: deterministic DOM/snapshot analysis
   ├─ reproduce: fresh-context replay
   ├─ report: summary, coverage, limitations
   └─ ai: optional planner/interpretation assist
   │
   ├──► packages/db: Prisma/PostgreSQL or file-store repositories
   ├──► evidence object store: local filesystem today, S3-shaped interface
   └──► in-process event bus → SSE → UI progress, logs, and live frames
```

Live runs stay in the process that owns the browser so frames and human input can be streamed. Background runs are queue-driven and can be handled by any worker. Live interaction uses Server-Sent Events for frames/status and authenticated POST requests for input; it is not a WebSocket server.

## Repository map

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js 15 App Router UI and API routes; port `4101`. |
| `apps/worker` | Standalone queue consumer for background runs. |
| `packages/shared` | Domain types, Zod request schemas, constants, deterministic RNG. |
| `packages/db` | Config, crypto/vault, store ports, file and Prisma adapters, object store. |
| `packages/engine` | Browser engine, exploration, validation, detection, reproduction, reporting, AI provider. |
| `packages/jobs` | `LocalQueue` and BullMQ `BullQueue` adapters. |
| `scripts` | Smoke test and browser probe utilities. |
| `tests` | Vitest suites and isolated test environment setup. |

The UI uses React 19, TypeScript, Tailwind CSS, Radix UI primitives, and shadcn-style local components. Tests use Vitest. Persistence is Prisma/PostgreSQL in production mode and a JSON file store in local mode.

## Run modes and manual login

- **Live** — starts in the web process, creates a live session, streams CDP screenshots and progress over SSE, and supports pause, takeover, release, detach, stop, and `login_complete` actions.
- **Background** — enqueues a `run_test` job. It runs headless and is picked up by the inline worker in local mode or by `apps/worker` in Redis mode.
- **Authenticated** — if `requireAuth` is set and a password field is visible, a live run pauses in `awaiting_login`. A human signs in through the live view, presses the sign-in-complete action, and SmartQA encrypts the Playwright storage state with AES-256-GCM. Later runs for the same origin and user load that state; expired or undecryptable entries are revoked.
- A background run with `requireAuth` is rejected with `AUTH_REQUIRES_LIVE` unless an unexpired vault session already exists for that origin.

## Safety and scope

- Only `http://` and `https://` URLs are accepted; embedded credentials and internal hostnames are blocked.
- DNS resolution and every request are checked against an SSRF policy. Private/loopback/link-local addresses require `ALLOW_PRIVATE_NETWORKS=true`.
- The new-run form requires an explicit attestation that the operator owns or is authorized to test the target.
- Destructive controls such as delete, pay, or unsubscribe are blocked by default. Opt-in still requires approved label patterns.
- Browser sessions are isolated per run, service workers are blocked, and evidence is not exposed from a public path.
- Passwords for the tested site are never handled by the agent; only a human-owned browser session is captured.

## Configuration

`.env.example` is the canonical starting point. Important defaults:

| Variable | Default | Meaning |
| --- | --- | --- |
| `STORAGE_DRIVER` | `file` | Use `postgres` (plus `DATABASE_URL`) for shared/multi-instance storage. |
| `QUEUE_DRIVER` | `local` | Use `redis` (plus `REDIS_URL`) for BullMQ workers. |
| `SESSION_ENCRYPTION_KEY` | development-only value | Must be 32+ characters in production; protects vaulted browser sessions. |
| `APP_URL` | `http://127.0.0.1:4101` | Absolute app origin for links and PDF rendering. |
| `PLAYWRIGHT_HEADLESS` | `true` | Controls Chromium launch mode. |
| `MAX_CONCURRENT_BROWSERS` | `2` | Browser concurrency setting; parsed but not currently enforced by the engine. |
| `RUN_TIMEOUT_MS` | `600000` | Global run wall-clock cap. |
| `LLM_API_KEY` | empty | Empty means fully deterministic operation. |
| `ALLOW_PRIVATE_NETWORKS` | `false` | Enable only for owned/local targets. |
| `ALLOW_DESTRUCTIVE_ACTIONS` | `false` | Keep false unless data loss is acceptable. |

Additional source-supported variables such as `SESSION_TTL_DAYS`, `BOOTSTRAP_NAME`, `PLAYWRIGHT_BROWSERS_PATH`, `SMARTQA_DATA_DIR`, `INLINE_WORKER`, and `WORKER_CONCURRENCY` are documented in [docs/SETUP.md](docs/SETUP.md).

There is no Dockerfile or compose configuration in this repository. Run the processes directly with the npm scripts described in setup.

## Documentation

- [Setup and configuration](docs/SETUP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Verification](docs/VERIFICATION.md)
# SmartQA
