# Architecture

SmartQA is an npm workspace monorepo with a clear split between UI/API, queueing, browser automation, persistence, and reporting. Local mode is deliberately zero-infrastructure; the production adapters are explicit switches, not implicit behaviour.

- [System shape](#system-shape)
- [Repository layout](#repository-layout)
- [Request and run flow](#request-and-run-flow)
- [Process and runtime topology](#process-and-runtime-topology)
- [Engine modules](#engine-modules)
- [Data model](#data-model)
- [Authentication and session reuse](#authentication-and-session-reuse)
- [Events, live view, and control](#events-live-view-and-control)
- [Deterministic validation and AI assistance](#deterministic-validation-and-ai-assistance)
- [Evidence and reporting](#evidence-and-reporting)
- [Safety and security](#safety-and-security)
- [Replacing the object store](#replacing-the-object-store)
- [Known incomplete features](#known-incomplete-features)

## System shape

```text
┌──────────────────────┐
│ Next.js web UI       │  /login, /runs, /runs/new,
│ apps/web (port 4101) │  /runs/[id], /runs/[id]/live, /runs/[id]/report
└──────────┬───────────┘
           │ same-origin JSON + SSE
┌──────────▼───────────┐
│ Next.js API routes   │  /api/auth/*, /api/runs/*,
│ apps/web/app/api     │  /api/live/*, /api/health
└──────────┬───────────┘
           │ createRun(): validate URL, ensure Site, persist TestRun, enqueue
┌──────────▼───────────┐
│ Queue                │  LocalQueue (DB poll) or BullQueue (Redis/BullMQ)
│ packages/jobs        │  jobs: run_test, reproduce_finding
└──────────┬───────────┘
           │ handleJob()
┌──────────▼───────────┐
│ Worker               │  inline in web (local) or apps/worker (Redis / dedicated)
└──────────┬───────────┘
           │ startRun() / executeRunById()
┌──────────▼───────────┐
│ Engine               │  packages/engine
│  browser → explore   │  Playwright Chromium, CDP, seeded state graph,
│  → detect/validate   │  deterministic checks, filter campaigns,
│  → reproduce/report  │  replay, summary, coverage
└───────┬────────┬─────┘
        │        │
        ▼        ▼
┌───────────────┐ ┌──────────────────────────┐
│ Store         │ │ Object store + events    │
│ file | Prisma │ │ evidence files, SSE bus, │
│ PostgreSQL    │ │ live screencast frames   │
└───────────────┘ └──────────────────────────┘
```

The UI streams progress using Server-Sent Events (SSE), which provides the "WebSocket-style" live experience. Mouse/keyboard input is sent through authenticated POST requests, not a WebSocket connection.

## Repository layout

| Workspace | Responsibility |
| --- | --- |
| `apps/web` | Next.js 15 App Router UI/API. React 19, TypeScript, Tailwind CSS, Radix UI primitives, and shadcn-style local components. Port `4101`. |
| `apps/worker` | Standalone queue consumer; `npm run worker` starts it with `tsx`. |
| `packages/shared` | Framework-agnostic domain types, constants, Zod schemas, deterministic 32-bit RNG. |
| `packages/db` | Config parsing, crypto, auth helpers, encrypted vault, repository interfaces, file and Prisma adapters, object store. |
| `packages/engine` | Browser engine, exploration, validation, detection, reproduction, reporting, AI provider, run orchestrator. |
| `packages/jobs` | `LocalQueue` and `BullQueue` implementations behind a `JobQueue` port. |
| `scripts` | `smoke.ts`, `browser-probe.ts`. |
| `tests` | Vitest suites with isolated temporary data directories. |
| `packages/db/prisma/schema.prisma` | PostgreSQL schema for the production store adapter. |

## Request and run flow

1. **Create run** — `POST /api/runs` validates the body with `createRunSchema`, requires an authorization attestation, checks the session cookie, applies an in-memory rate limit, normalizes the URL, and calls `assertSafeUrl`.
2. **Origin/site** — `ensureSite` creates or reuses a per-user `Site` keyed by origin and records `authorizationConfirmedAt`.
3. **Run record** — `createRun` builds a `TestRun` with mode, viewports, deterministic seed, budgets, evidence flags, focus, safety flags, empty progress, and status `queued`. It writes an audit entry.
4. **Dispatch** — Live runs call `startRun` and return a `liveSessionId`. Background runs enqueue a `run_test` job and call `ensureInlineWorker`.
5. **Worker** — `handleJob` loads the run and calls `executeRunById`. In Redis mode the same job handler runs in `apps/worker`.
6. **Orchestration** — `execute()` in `runner/orchestrator.ts` moves through `preparing`, optional `awaiting_login`, `running`, `finalizing`, and a terminal status. It enforces the smaller of run budget and `RUN_TIMEOUT_MS`, emits a heartbeat every 5 seconds, and persists logs.
7. **Browser** — `BrowserSession.launch` creates an isolated Chromium context with a URL guard, request interception, signal collectors, optional storage state, tracing, and CDP screencast for live runs.
8. **Explore/validate** — `Explorer` walks a state graph; `FilterEngine` runs filter campaigns; `analyzeSnapshot` and validation helpers produce checks and finding drafts. Evidence is captured as needed.
9. **Reproduce** — up to four high-confidence, non-suspected findings are replayed from a fresh browser context with the vaulted session when available.
10. **Report** — coverage, summary, and optional AI narrative are computed and persisted on the run. Audit `run.completed` or `run.failed` is recorded.
11. **Observe** — SSE routes replay history and subscribe to the in-process event bus; report and export routes assemble the final `RunReport`.

### API surface

| Route group | Endpoints |
| --- | --- |
| Health | `GET /api/health` |
| Auth | `POST /api/auth/login`, `POST /api/auth/register`, `POST /api/auth/logout`, `GET /api/auth/me` |
| Runs | `GET|POST /api/runs`, `GET /api/runs/[id]`, `POST /api/runs/[id]/actions`, `GET /api/runs/[id]/events` |
| Reports | `GET /api/runs/[id]/report`, `GET /api/runs/[id]/export/json`, `GET /api/runs/[id]/export/pdf` |
| Evidence | `GET /api/runs/[id]/evidence/[evidenceId]` |
| Live | `GET /api/live/[sessionId]`, `GET /api/live/[sessionId]/stream`, `POST /api/live/[sessionId]/input` |

Run control actions are `start`, `pause`, `resume`, `stop`, `takeover`, `release`, `detach`, `login_complete`, and `reproduce`.

## Process and runtime topology

- **Local/default** — `STORAGE_DRIVER=file`, `QUEUE_DRIVER=local`. The web process hosts a database-backed poller after the first background run. The file store is intended for a single process; use `INLINE_WORKER=false` plus `npm run worker` if you need one writer/owner for jobs.
- **Production** — `STORAGE_DRIVER=postgres`, `QUEUE_DRIVER=redis`. Web instances enqueue BullMQ jobs; `apps/worker` consumes them. PostgreSQL is the shared source of truth.
- **Live runs** are process-local. `LiveSession`, `RunControl`, event buses, and browser handles live in registries cached on `globalThis`, so Next.js hot reload does not orphan them. A live browser cannot be migrated to another worker.
- **Background runs** are not tied to a dashboard connection. They can be claimed by any configured worker and are observed through persisted logs and state.
- **Runtime singletons** in `packages/db` are also cached on `globalThis`, preventing duplicate file-store writers and repeated Prisma clients during development.

## Engine modules

| Module | Responsibility |
| --- | --- |
| `runner/orchestrator.ts` | Run lifecycle, browser provisioning, auth pause, budget/deadline enforcement, reproduction, final reporting, audit, cleanup. |
| `runner/registry.ts` | Process-local live sessions, event buses, run control handles (`pause`, `stop`, `takeover`, `detach`, login completion). |
| `runner/jobs.ts` | Queue job handler for `run_test` and `reproduce_finding`; no Next.js imports. |
| `browser/session.ts` | Chromium launch with channel/executable fallbacks, isolated context, storage-state reuse, tracing, CDP screencast, live input dispatch. |
| `browser/domSnapshot.ts` | Self-contained in-page collector for interactive elements, roles, labels, boxes, filters, metrics, tables, images, overflow, overlap, spinners, sentinels, and visible blocking dialogs (`modal`). |
| `browser/readiness.ts` | Load/network/DOM quiescence and bounded action-outcome waits instead of fixed sleeps. |
| `browser/collectors.ts` | Timestamped console errors, page errors, HTTP errors, request failures, dialogs, and browser init script. |
| `security/ssrf.ts` | `assertSafeUrl` and `RunUrlGuard`: protocol, credentials, DNS, private/link-local/metadata blocking for navigation and subresources. |
| `explore/explorer.ts` | Breadth-first state graph, action registration/execution, dedupe, loop prevention, budgets, limitations. |
| `explore/safety.ts` | Destructive-action risk assessment and approved-pattern policy. |
| `validate/metrics.ts` | Number parsing, metric kind/additivity classification, partition sums, table totals, coherence checks. |
| `validate/filters.ts` | Filter dimension discovery, seeded combination planning, order/reset probes, metric snapshots, filter checks. |
| `detect/analyzeSnapshot.ts` | Deterministic snapshot analysis and finding/check drafts with evidence references. |
| `checks.ts` / `findings.ts` | Persisted check results with deduplicated counts; fingerprint-based finding dedupe, severity, occurrence counts. |
| `evidence.ts` | Object-store persistence for screenshots, traces, DOM/HTML, logs, and metrics; checksums and finding references. |
| `reproduce/reproducer.ts` | Replays recorded action paths in fresh contexts to classify reproducibility. |
| `report/aggregate.ts` | Summary, honest coverage statement, filter test view, report serialization. |
| `events.ts` | In-process `RunEventBus` with a bounded ring buffer for reconnect replay. |
| `ai/provider.ts` | Optional OpenAI-compatible planner/interpretation calls with bounded, validated outputs. |

## Data model

`packages/db/prisma/schema.prisma` defines the PostgreSQL adapter. The application talks to repository ports in `packages/db/src/store/types.ts`, not directly to Prisma. The same entities are implemented by `createFileStore` for local mode and `createPrismaStore` for PostgreSQL mode.

| Model | Key fields / relationships |
| --- | --- |
| `User` | Unique email, scrypt password hash. Has many `Site`, `TestRun`, `AuthSession`, `SessionVault`, `JobRecord`, `AuditLog`, `AiDecision`. |
| `AuthSession` | `tokenHash` only, expiry, last seen. Belongs to `User` (`onDelete: Cascade`). |
| `Site` | Per-user `(userId, origin)` unique; authorization timestamp, run count. Belongs to `User` cascade; has many `TestRun`. |
| `TestRun` | URL/origin, mode/status, JSON `config`/`progress`/`summary`/`coverage`, auth state, heartbeats, cancel request. Belongs to `User` cascade and optional `Site` (`onDelete: SetNull`); owns pages, actions, findings, evidence, snapshots, dimensions, combinations, checks, logs, jobs, and AI decisions. |
| `PageState` | Normalized URL, DOM signature, depth, parent action, visit count, skeleton flag. Belongs to `TestRun` cascade. |
| `ActionRecord` | Kind/status/outcome, element JSON, risk, timing, before/after URLs, signal summary. Belongs to `TestRun` cascade. |
| `Finding` | Category, severity, confidence, status, expected/observed, calculation JSON, reproduction JSON, evidence refs JSON, fingerprint, tags, occurrence count. Belongs to `TestRun` cascade. |
| `Evidence` | Kind, content type, size, checksum, unique `storageKey`, metadata JSON. Belongs to `TestRun` cascade; `findingId` is a scalar link, and `Finding.evidence` is a JSON reference array rather than a Prisma relation. |
| `MetricSnapshot` | Viewport, captured metrics JSON, table JSON, row count, optional combination link. Belongs to `TestRun` cascade. |
| `FilterDimension` | Label, kind, selector, options JSON, option source, multiple flag. Belongs to `TestRun` cascade. |
| `FilterCombination` | Kind, selections JSON, order array, state, state key, snapshot/error. Belongs to `TestRun` cascade. |
| `CheckResult` | Check kind/status, deterministic flag, evidence ID array, calculation JSON, timing. Belongs to `TestRun` cascade. |
| `SessionVault` | Encrypted `ciphertext`/`iv`/`authTag`, key version, origin, expiry, revocation. Belongs to `User` cascade; `siteId` and `runId` are scalar correlation fields, not Prisma relations. |
| `JobRecord` | Kind, payload JSON, state, priority, attempts, worker ID. Belongs to `User` cascade and optional `TestRun` cascade. |
| `RunLog` | Monotonic `seq` unique per run, level, message, action link, data JSON. Belongs to `TestRun` cascade. |
| `AiDecision` | Purpose, summary, accepted, tokens, timestamp. Belongs to both `TestRun` and `User` with cascade. |
| `AuditLog` | Action, detail JSON, IP, timestamp. Optional `User` relation (`onDelete: SetNull`); `runId` is recorded as a scalar. |

Nested engine-owned structures are JSON/JSONB because they are read as a whole and strongly typed at the package boundary. Every run-scoped table is indexed by `runId`.

## Authentication and session reuse

- The web session cookie is `smartqa_session`, HTTP-only and SameSite=Lax; `secure` is enabled when `NODE_ENV=production`. Only a SHA-256 hash of the 32-byte token is stored in `AuthSession`.
- When a live run has `requireAuth` and a visible password field, the orchestrator sets status `awaiting_login` and waits up to 15 minutes for `login_complete`.
- A human signs in through the live browser. The resulting Playwright storage state is encrypted with AES-256-GCM using a 32-byte key derived from `SESSION_ENCRYPTION_KEY`, then stored in `SessionVault` with a TTL.
- Later runs for the same user/origin load and decrypt that state into a fresh context. Expired or tampered entries are skipped or revoked. Saving a new session revokes older ones for the same user/origin.
- Background runs with `requireAuth` require an existing vault session; otherwise the API returns `AUTH_REQUIRES_LIVE`.
- The tested site's password is never given to or stored by the agent.

## Events, live view, and control

- `RunEventBus` emits `run`, `progress`, `log`, `action`, `page`, `check`, `finding`, `snapshot`, and `heartbeat` events, with a 300-event in-memory ring.
- `GET /api/runs/[id]/events` sends the current run, bus history, recent persisted logs, live events, and 15-second heartbeats over SSE.
- `GET /api/live/[sessionId]/stream` sends CDP screencast frames and status. `POST /api/live/[sessionId]/input` forwards validated mouse/keyboard/type/scroll events only while awaiting login or after takeover.
- Control is cooperative: `RunControl.gate()` pauses between agent steps. Stop resolves pending login waits, detaches streaming, and finalizes partial results as `cancelled`.
- Run states: `queued`, `preparing`, `awaiting_login`, `running`, `paused`, `finalizing`, `completed`, `failed`, `cancelled`.

## Deterministic validation and AI assistance

The validator never asks the model what the expected value should be. Expectations are derived from numbers the application displayed, using arithmetic only when a metric is known to be additive.

- Deterministic checks cover invalid tokens, broken images, layout overflow, overlap, missing content, table totals, pagination, console/network signals, loading resolution, filter reset, additivity, order, subsets, and empty states.
- `classifyAdditivity` treats averages, percentages, ratios, rates, medians, distinct counts, scores, and similar labels as non-additive. Partition sums are accepted only when parts are exhaustive/known to be additive.
- With `LLM_API_KEY` set, `AiAssistant` may:
  - re-rank a bounded list of already discovered actions (the returned ID must exist in the candidate list);
  - classify an unfamiliar metric, with unsafe additive claims rejected;
  - write an executive summary from deterministic facts only.
- Page content is wrapped as untrusted data in prompts. Model outputs are parsed against Zod schemas and rejected when invalid. Failures fall back to deterministic behaviour.

## Evidence and reporting

Evidence kinds include screenshots, full-page screenshots, traces, console/network logs, DOM snapshots, metrics JSON, and page HTML. `EvidenceService` writes binary content to the object store, records storage key, checksum, content type, and size in the `Evidence` table, and caps capture at 160 objects per run.

The final `RunReport` contains:

- `meta` with generator, format version, run ID, seed, URL, and mode.
- `run`, `summary`, `coverage`, `findings`, `checks`, `snapshots`, `filterTests`, `stateGraph`, and `logs`.
- `limitations` and a `coverage.completeness` verdict of `smoke`, `partial`, `broad`, or `exhaustive`.
- `aiUsage` and an optional `narrative`.

Coverage is behavioural sampling, not proof of correctness. The accumulator explicitly adds limitations for unexecuted interactions, exhausted budgets, skipped destructive actions, absent mobile viewport, and untested states.

JSON export is generated directly from `buildReportForRun`. PDF export renders the authenticated report page in Chromium with `page.pdf()`; if Chromium is unavailable the route returns `PDF_UNAVAILABLE` and JSON remains available.

## Safety and security

- URL policy: HTTP(S) only, no embedded credentials, blocked internal hostnames, DNS resolution with a short cache, and private/loopback/link-local/IPv6 checks for navigations and subresources.
- `ALLOW_PRIVATE_NETWORKS` defaults to `false`; enable only for owned or explicitly authorized local targets.
- Destructive actions are blocked by default. Explicit opt-in plus approved label patterns is required; the UI requires an ownership/authorization attestation before a run starts.
- Browser contexts are isolated per run, service workers are blocked, and HTTPS errors are ignored only inside the testing browser so local targets remain usable.
- Evidence is delivered through authenticated routes with `private` cache headers, `nosniff`, and a sandbox CSP.
- Login and run creation are rate-limited in memory; a multi-instance deployment needs a shared rate limiter.
- The in-memory rate limiter and live registry are per process; plan sticky routing or shared limits if scaling web instances.

## Replacing the object store

`ObjectStore` in `packages/db/src/objectStore.ts` is a small port:

```ts
put(key, data, contentType)
get(key)
stat(key)
delete(key)
```

`createObjectStore(dataDir)` currently returns `LocalObjectStore`, rooted at `<dataDir>/evidence`. Keys are server-generated; `resolveKey` rejects traversal and absolute keys.

To add S3/MinIO later:

1. Implement the `ObjectStore` interface with your SDK client and bucket configuration.
2. Preserve checksums and content types so existing `Evidence` rows remain meaningful.
3. Add explicit driver/config selection instead of relying on the placeholder function in `objectStore.ts`.
4. Keep evidence binary reads behind the authenticated API; never hand object URLs to the browser.

## Known incomplete features

- External object storage is an S3-shaped extension point only; no S3/MinIO adapter is implemented.
- No Dockerfile, compose file, or devcontainer is configured.
- The orchestrator launches one browser context using `config.viewports[0]`. Selecting both desktop and mobile does not currently produce two full runs; mobile-only runs are supported.
- `AiAssistant` records decisions in memory, but nothing currently writes them through `store.aiDecisions`, so report `aiUsage.decisions` may be empty even when a model was used.
- `MAX_CONCURRENT_BROWSERS` is parsed into `AppConfig` but is not used to limit launches in the current engine.
- Multi-instance deployments need shared rate limiting; the current limiter is process-local.
- The bundled demo app and demo-only end-to-end/API harness scripts have been removed; full end-to-end verification now requires an authorized external target and manual acceptance checks (see [VERIFICATION.md](VERIFICATION.md)).
