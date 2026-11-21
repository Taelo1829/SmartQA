# Verification

This page records what "verified" means for SmartQA at this revision. The bundled demo app and demo-only end-to-end/API harness scripts (`scripts/e2e-engine.ts`, `scripts/verify-api.ts`) have been removed, so verification is based on automated checks plus manual runs against a target you own or are authorized to test.

- [Current status](#current-status)
- [Commands](#commands)
- [What each check covers](#what-each-check-covers)
- [Manual acceptance checks](#manual-acceptance-checks)
- [Known gaps](#known-gaps)

## Current status

| Area | Command | Notes |
| --- | --- | --- |
| TypeScript project build/typecheck | `npm run typecheck` | Validates project references across web, worker, engine, db, jobs, shared. |
| Unit and integration suites | `npm test` | Vitest suites under `tests/**/*.test.ts` (includes synthetic browser E2E cases). |
| Production build (web) | `npm run build` | Builds the Next.js web app. |
| Platform smoke test | `npm run smoke` | Store/crypto/math/guardrails/snapshot/browser launch invariants without external infra. |
| Synthetic browser E2E suite | `npm run test:e2e` | `vitest.e2e.config.ts` against `tests/**/*.e2e.test.ts` (browser capability suite). |
| Full target-site engine/API verification | manual | Run against an authorized external/staging/local target (see below). |

A passing automated run and a successful manual run are evidence of behavior on the exercised paths only. Coverage is sampled and budget-limited and never proves a target is defect-free.

## Commands

Run from the repository root:

```powershell
npm run typecheck
npm test
npm run build
npm run smoke
npm run test:e2e
```

## What each check covers

### `npm run typecheck`

Runs `tsc -b --pretty false` across the TypeScript project references. It validates the shared domain contract, store adapters, engine, jobs, worker, and API/server code.

### `npm test`

Runs Vitest with `vitest.config.ts`, `tests/setup.ts`, and all `tests/**/*.test.ts` files. The setup file isolates the suite with:

- a temporary `SMARTQA_DATA_DIR`;
- a deterministic `SESSION_ENCRYPTION_KEY`;
- `STORAGE_DRIVER=file` and `QUEUE_DRIVER=local`;
- `LLM_API_KEY` empty, so no external model calls occur;
- `ALLOW_PRIVATE_NETWORKS=true` for local browser tests.

The suites cover file-store persistence and crypto, metric parsing/additivity/partition arithmetic, snapshot detection, SSRF and destructive-action guardrails, filter planning, report/coverage honesty, browser launch and DOM interaction, and synthetic end-to-end engine capabilities.

### `npm run build`

Builds the Next.js web app (`@smartqa/web`). This catches App Router, server/client boundary, and production compilation problems.

### `npm run smoke`

Runs `scripts/smoke.ts` without external infrastructure. It asserts:

1. file-store persistence and scrypt password hashing;
2. AES-256-GCM vault encryption round-trip;
3. additive/non-additive arithmetic, including a partition mismatch case;
4. SSRF blocking of the cloud metadata address and destructive-action blocking;
5. deterministic detection of invalid sentinels and broken images;
6. Chromium launch and DOM execution.

### `npm run test:e2e`

Runs `vitest.e2e.config.ts` against `tests/**/*.e2e.test.ts`. The current suite creates a rich synthetic page in-browser and proves DOM discovery, interactive state tracking, table-total mismatch detection, non-additive classification, and page-error collection. It is a browser capability suite, not a full run against an external target.

## Manual acceptance checks

Use a site you own or are explicitly authorized to test. For localhost/private targets, set `ALLOW_PRIVATE_NETWORKS=true` for the web/worker process and restart it (the Next.js server may require it in the shell or `apps/web/.env.local`).

1. Start the app (`npm run dev` or `npm run build && npm run start`) and sign in (bootstrap `qa@smartqa.local` / `smartqa-demo-2026` from `.env.example`, or a registered account).
2. Start a **live** run against an authorized URL. Confirm progress events arrive and live frames appear.
3. Use **Take control**, send input, then **Release**; confirm the agent resumes.
4. For an authenticated target, confirm the run can pause in `awaiting_login`, manual sign-in works, `login_complete` continues the run, and a later background run for the same origin reuses the vaulted session (or returns `AUTH_REQUIRES_LIVE` when no session exists).
5. Start a **background** run and confirm it reaches a terminal status with progress/report available without depending on the live view.
6. Confirm findings link to evidence served only after authentication.
7. Open the report and export both JSON and PDF; if PDF rendering is unavailable, the failure should be explicit while JSON remains available.
8. For flows that open a prerequisite dialog (e.g. select a supplier group then Apply), confirm SmartQA attempts to complete the dialog before validating the view and does not report expected pre-selection placeholder values (`NaN`/`undefined`) shown while the dialog is open as defects.
9. Confirm the report lists limitations and never claims exhaustive coverage for a sampled run.

## Known gaps

- Coverage is sampled and budget-limited; untested states may still contain defects.
- Selecting both desktop and mobile viewports does not currently execute two complete viewport-specific runs; the orchestrator uses the first viewport.
- AI decisions are kept in memory by the assistant but are not persisted to `AiDecision`, so report `aiUsage.decisions` may be empty even when a model was used.
- External object storage and container orchestration are not configured; local verification uses the filesystem, file store, and local queue.
- Multi-instance rate limiting and live-session affinity need infrastructure outside this repository.
- `MAX_CONCURRENT_BROWSERS` is parsed but not enforced by the engine.
