import { loadDotEnv } from './env';
import { resolveDataDir } from './paths';

// Node processes (scripts, worker) do not get Next.js's automatic dotenv
// handling. Load defaults once before any config is read.
loadDotEnv();

export interface LlmConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface BrowserConfig {
  channel?: string;
  headless: boolean;
  browsersPath?: string;
}

export interface AppConfig {
  storageDriver: 'file' | 'postgres';
  databaseUrl?: string;
  queueDriver: 'local' | 'redis';
  redisUrl?: string;
  dataDir: string;
  appUrl: string;
  sessionTtlDays: number;
  runTimeoutMs: number;
  maxConcurrentBrowsers: number;
  allowPrivateNetworks: boolean;
  allowDestructiveActions: boolean;
  llm: LlmConfig;
  browser: BrowserConfig;
  bootstrap: { email: string; password: string; name: string };
  nodeEnv: string;
  isProduction: boolean;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const storageDriver = env.STORAGE_DRIVER === 'postgres' ? 'postgres' : 'file';
  const queueDriver = env.QUEUE_DRIVER === 'redis' ? 'redis' : 'local';
  const isProduction = env.NODE_ENV === 'production';

  return {
    storageDriver,
    databaseUrl: env.DATABASE_URL,
    queueDriver,
    redisUrl: env.REDIS_URL,
    dataDir: resolveDataDir(env),
    appUrl: (env.APP_URL ?? 'http://127.0.0.1:4101').replace(/\/$/, ''),
    sessionTtlDays: int(env.SESSION_TTL_DAYS, 7),
    runTimeoutMs: int(env.RUN_TIMEOUT_MS, 10 * 60_000),
    maxConcurrentBrowsers: Math.max(1, int(env.MAX_CONCURRENT_BROWSERS, 2)),
    allowPrivateNetworks: bool(env.ALLOW_PRIVATE_NETWORKS, false),
    allowDestructiveActions: bool(env.ALLOW_DESTRUCTIVE_ACTIONS, false),
    llm: {
      enabled: Boolean(env.LLM_API_KEY),
      baseUrl: (env.LLM_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
      apiKey: env.LLM_API_KEY ?? '',
      model: env.LLM_MODEL ?? 'gpt-4o-mini',
    },
    browser: {
      channel: env.PLAYWRIGHT_CHANNEL || undefined,
      headless: bool(env.PLAYWRIGHT_HEADLESS, true),
      browsersPath: env.PLAYWRIGHT_BROWSERS_PATH || undefined,
    },
    bootstrap: {
      email: env.BOOTSTRAP_EMAIL ?? 'qa@smartqa.local',
      password: env.BOOTSTRAP_PASSWORD ?? 'smartqa-demo-2026',
      name: env.BOOTSTRAP_NAME ?? 'QA Operator',
    },
    nodeEnv: env.NODE_ENV ?? 'development',
    isProduction,
  };
}
