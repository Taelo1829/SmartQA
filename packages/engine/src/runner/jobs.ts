import path from 'node:path';
import type { JobRecord } from '@smartqa/shared';
import { getConfig, getRuntime, getStore, getVault } from '@smartqa/db';
import { BrowserSession } from '../browser/session';
import { EvidenceService } from '../evidence';
import { Reproducer, type ReproSessionOptions } from '../reproduce/reproducer';
import { RunUrlGuard } from '../security/ssrf';
import { executeRunById } from './orchestrator';

/**
 * Queue job handler, shared by the API's inline worker (local mode) and the
 * standalone worker process. Deliberately free of Next.js imports.
 */
export async function handleJob(job: JobRecord): Promise<void> {
  const store = await getStore();
  const config = getConfig();

  if (job.kind === 'run_test') {
    const runId = (job.payload as { runId?: string }).runId ?? job.runId;
    if (!runId) throw new Error('run_test job has no runId');
    await executeRunById(runId);
    return;
  }

  if (job.kind === 'reproduce_finding') {
    const findingId = (job.payload as { findingId?: string }).findingId;
    if (!findingId) throw new Error('reproduce_finding job has no findingId');
    const finding = await store.findings.get(findingId);
    if (!finding) throw new Error(`Finding ${findingId} not found`);
    const run = await store.runs.get(finding.runId);
    if (!run) throw new Error(`Run ${finding.runId} not found`);

    const vault = await getVault();
    const guard = new RunUrlGuard(run.url, { allowPrivateNetworks: config.allowPrivateNetworks });
    const evidence = new EvidenceService(store, getRuntime().objects);
    const reproducer = new Reproducer({
      store,
      run,
      evidence,
      tracesDir: path.join(config.dataDir, 'traces'),
      getStorageState: async () => (await vault.load(run.userId, run.origin))?.storageState,
      log: async (level, message) => {
        console.log(`[smartqa:reproduce:${level}] ${message}`);
      },
      createSession: async (options: ReproSessionOptions) =>
        BrowserSession.launch({
          runId: run.id,
          headless: config.browser.headless,
          channel: config.browser.channel,
          viewport: options.viewport,
          storageState: options.storageState,
          urlGuard: guard,
          traceDir: options.traceDir,
          artifactsDir: config.dataDir,
        }),
    });
    await reproducer.reproduce(finding);
    return;
  }

  throw new Error(`Unsupported job kind: ${job.kind}`);
}
