import { existsSync } from 'node:fs';
import path from 'node:path';

/** Walk up from `start` until the monorepo root (package.json with workspaces). */
export function findWorkspaceRoot(start: string = process.cwd()): string {
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    const pkgPath = path.join(current, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(require('node:fs').readFileSync(pkgPath, 'utf8')) as { workspaces?: unknown };
        if (pkg.workspaces) return current;
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.resolve(start);
}

/** Directory for the file store, evidence and logs. Configurable for tests. */
export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SMARTQA_DATA_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(findWorkspaceRoot(), '.data');
}
