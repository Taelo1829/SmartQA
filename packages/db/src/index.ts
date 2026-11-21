import { loadConfig, type AppConfig } from './config';
import { createObjectStore, type ObjectStore } from './objectStore';
import { resolveDataDir } from './paths';
import { createFileStore } from './store/fileStore';
import { createPrismaStore } from './store/prismaStore';
import type { Store } from './store/types';
import { SessionVaultService } from './vault';

export * from './config';
export * from './env';
export * from './paths';
export * from './crypto';
export * from './auth';
export * from './vault';
export * from './objectStore';
export * from './store/types';
export { createFileStore } from './store/fileStore';
export { createPrismaStore } from './store/prismaStore';

interface Runtime {
  config: AppConfig;
  store: Promise<Store>;
  objects: ObjectStore;
  vault?: SessionVaultService;
}

const CACHE_KEY = Symbol.for('smartqa.runtime.v1');

type GlobalWithRuntime = typeof globalThis & { [CACHE_KEY]?: Runtime };

/**
 * Process-wide runtime singletons.
 *
 * Cached on globalThis so Next.js dev HMR does not spawn a new store (and, for
 * the file driver, a second writer) on every request.
 */
export function getRuntime(env: NodeJS.ProcessEnv = process.env): Runtime {
  const global_ = globalThis as GlobalWithRuntime;
  if (global_[CACHE_KEY]) return global_[CACHE_KEY]!;

  const config = loadConfig(env);
  const dataDir = resolveDataDir(env);
  const store =
    config.storageDriver === 'postgres'
      ? createPrismaStore(config.databaseUrl)
      : Promise.resolve(createFileStore({ dataDir }));

  // Surface misconfiguration immediately instead of on the first request.
  store.catch((error: Error) => {
    console.error('[smartqa] storage initialisation failed:', error.message);
  });

  const runtime: Runtime = {
    config,
    store,
    objects: createObjectStore(dataDir),
  };
  global_[CACHE_KEY] = runtime;
  return runtime;
}

export async function getStore(): Promise<Store> {
  return getRuntime().store;
}

export function getConfig(): AppConfig {
  return getRuntime().config;
}

export async function getVault(): Promise<SessionVaultService> {
  const runtime = getRuntime();
  if (!runtime.vault) {
    const store = await runtime.store;
    runtime.vault = new SessionVaultService(store, runtime.config.sessionTtlDays);
  }
  return runtime.vault;
}

/** Test helper: drop cached singletons (file store reloads from disk). */
export function resetRuntimeForTests(): void {
  const g = globalThis as GlobalWithRuntime;
  delete g[CACHE_KEY];
}
