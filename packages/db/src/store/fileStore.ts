import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FilterValue, FindQuery, Repository, Store } from './types';

/**
 * Durable JSON-file store.
 *
 * Purpose: let the whole platform run with zero external infrastructure
 * (no Postgres, no Redis) so a reviewer can clone, `npm install`, `npm run dev`
 * and test a site. Every collection is an append-friendly JSON file written
 * atomically (temp file + rename) under `<dataDir>/db`.
 *
 * Trade-offs, documented rather than hidden:
 *  - single writer process (the API server owns the files),
 *  - whole-collection rewrites on mutation (fine for QA-scale data),
 *  - no transactions across collections.
 * Production deployments set STORAGE_DRIVER=postgres.
 */

interface FileEnvelope<T> {
  version: 1;
  collection: string;
  entities: T[];
}

type AnyRecord = Record<string, unknown>;

function isRange(value: unknown): value is Record<string, number | string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => ['lt', 'lte', 'gt', 'gte'].includes(key));
}

function isNot(value: unknown): value is { not: unknown } {
  return !!value && typeof value === 'object' && !Array.isArray(value) && 'not' in (value as AnyRecord);
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);
  if (Array.isArray(a) && Array.isArray(b)) return a.length - b.length;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

export function matchesWhere(entity: AnyRecord, where: Record<string, FilterValue | undefined>): boolean {
  for (const [field, expected] of Object.entries(where)) {
    if (expected === undefined) continue;
    const actual = entity[field];
    if (Array.isArray(expected)) {
      if (!expected.some((candidate) => candidate === actual)) return false;
      continue;
    }
    if (isRange(expected)) {
      if (actual === undefined || actual === null) return false;
      for (const [op, bound] of Object.entries(expected)) {
        if (bound === undefined) continue;
        const cmp = compareValues(actual, bound);
        if (op === 'lt' && !(cmp < 0)) return false;
        if (op === 'lte' && !(cmp <= 0)) return false;
        if (op === 'gt' && !(cmp > 0)) return false;
        if (op === 'gte' && !(cmp >= 0)) return false;
      }
      continue;
    }
    if (isNot(expected)) {
      if (actual === expected.not) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

class FileRepository<T extends { id: string }> implements Repository<T> {
  private entities: Map<string, T> | null = null;
  private loading: Promise<Map<string, T>> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly collection: string,
  ) {}

  private async load(): Promise<Map<string, T>> {
    if (this.entities) return this.entities;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      try {
        const raw = await readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as FileEnvelope<T>;
        const map = new Map<string, T>();
        for (const entity of parsed.entities ?? []) map.set(entity.id, entity);
        this.entities = map;
        return map;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          // A corrupt store is fatal: silently starting empty would destroy data.
          throw new Error(`Failed to read collection ${this.collection}: ${(error as Error).message}`);
        }
        this.entities = new Map();
        return this.entities;
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  private async persist(entities: Map<string, T>): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const envelope: FileEnvelope<T> = { version: 1, collection: this.collection, entities: [...entities.values()] };
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmp, JSON.stringify(envelope), 'utf8');
      await rename(tmp, this.filePath);
    });
    return this.writeChain;
  }

  async create(entity: T): Promise<T> {
    const entities = await this.load();
    if (entities.has(entity.id)) throw new Error(`Duplicate id ${entity.id} in ${this.collection}`);
    entities.set(entity.id, entity);
    await this.persist(entities);
    return entity;
  }

  async createMany(items: T[]): Promise<T[]> {
    const entities = await this.load();
    for (const item of items) entities.set(item.id, item);
    await this.persist(entities);
    return items;
  }

  async get(id: string): Promise<T | null> {
    return (await this.load()).get(id) ?? null;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const entities = await this.load();
    const existing = entities.get(id);
    if (!existing) throw new Error(`Not found: ${this.collection}/${id}`);
    const updated = { ...existing, ...patch, id } as T;
    entities.set(id, updated);
    await this.persist(entities);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const entities = await this.load();
    entities.delete(id);
    await this.persist(entities);
  }

  async find(query: FindQuery = {}): Promise<T[]> {
    const entities = await this.load();
    let rows = [...entities.values()];
    if (query.where) rows = rows.filter((row) => matchesWhere(row as AnyRecord, query.where!));
    const field = query.orderBy?.field ?? 'createdAt';
    const direction = query.orderBy?.direction ?? 'desc';
    rows.sort((a, b) => {
      const primary = compareValues((a as AnyRecord)[field], (b as AnyRecord)[field]);
      const tie = primary !== 0 ? primary : compareValues(a.id, b.id) || 0;
      return direction === 'asc' ? tie : -tie;
    });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 1_000;
    return rows.slice(offset, offset + limit);
  }

  async count(where: Record<string, FilterValue | undefined> = {}): Promise<number> {
    const entities = await this.load();
    if (Object.keys(where).length === 0) return entities.size;
    return [...entities.values()].filter((row) => matchesWhere(row as AnyRecord, where)).length;
  }
}

export interface FileStoreOptions {
  dataDir: string;
}

export function createFileStore({ dataDir }: FileStoreOptions): Store {
  const base = path.join(dataDir, 'db');
  const repo = <T extends { id: string }>(collection: string): Repository<T> =>
    new FileRepository<T>(path.join(base, `${collection}.json`), collection);

  return {
    driver: 'file',
    users: repo('users'),
    authSessions: repo('auth-sessions'),
    sites: repo('sites'),
    runs: repo('runs'),
    pages: repo('pages'),
    actions: repo('actions'),
    findings: repo('findings'),
    evidence: repo('evidence'),
    snapshots: repo('snapshots'),
    filterDimensions: repo('filter-dimensions'),
    filterCombinations: repo('filter-combinations'),
    checks: repo('checks'),
    vault: repo('vault'),
    jobs: repo('jobs'),
    logs: repo('logs'),
    audit: repo('audit'),
    aiDecisions: repo('ai-decisions'),
    async close() {
      /* nothing to flush: writes are awaited */
    },
  };
}
