import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { findWorkspaceRoot } from './paths';

/**
 * Minimal dotenv loader for Node-side processes (tsx scripts, the standalone
 * worker). Next.js loads `.env` itself, but the engine and worker do not, which
 * previously meant a local run against a private/loopback target silently fell back to the insecure default
 * `ALLOW_PRIVATE_NETWORKS=false`.
 *
 * Precedence matches the usual twelve-factor convention: real process
 * environment variables always win; the project's `.env` provides defaults.
 * Loading is idempotent because config is a process-wide singleton.
 */
let loaded = false;

function parseValue(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    const quote = value[0];
    const inner = value.slice(1, -1);
    return quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"') : inner;
  }
  // An unquoted trailing comment is common in hand-written env files.
  return value.replace(/\s+#.*$/, '').trim();
}

function applyEnvFile(file: string): void {
  const content = readFileSync(file, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const declaration = trimmed.startsWith('export ') ? trimmed.slice(7).trim() : trimmed;
    const separator = declaration.indexOf('=');
    if (separator <= 0) continue;
    const key = declaration.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (process.env[key] !== undefined) continue;
    process.env[key] = parseValue(declaration.slice(separator + 1));
  }
}

/** Load `.env` defaults from the workspace root and current directory. */
export function loadDotEnv(): void {
  if (loaded) return;
  loaded = true;
  const roots = new Set<string>([findWorkspaceRoot(), process.cwd()]);
  for (const root of roots) {
    // `.env.local` is loaded first so it acts as the local override of `.env`,
    // while still never overwriting an explicitly supplied process variable.
    for (const name of ['.env.local', '.env']) {
      const file = path.join(root, name);
      if (existsSync(file)) applyEnvFile(file);
    }
  }
}
