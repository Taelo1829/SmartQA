import type { FilterValue, FindQuery, Repository, Store } from './types';

/**
 * PostgreSQL adapter (Prisma).
 *
 * Only loaded when STORAGE_DRIVER=postgres: the import of @prisma/client is
 * dynamic so local mode works without a generated client or a database.
 */

interface CollectionSpec {
  delegate: string;
  dateFields: string[];
  jsonFields: string[];
}

const SPECS: Record<string, CollectionSpec> = {
  users: { delegate: 'user', dateFields: ['createdAt', 'updatedAt'], jsonFields: [] },
  authSessions: { delegate: 'authSession', dateFields: ['createdAt', 'expiresAt', 'lastSeenAt'], jsonFields: [] },
  sites: {
    delegate: 'site',
    dateFields: ['authorizationConfirmedAt', 'createdAt', 'updatedAt', 'lastRunAt'],
    jsonFields: [],
  },
  runs: {
    delegate: 'testRun',
    dateFields: ['createdAt', 'startedAt', 'finishedAt', 'heartbeatAt', 'cancelRequestedAt'],
    jsonFields: ['config', 'progress', 'summary', 'coverage'],
  },
  pages: { delegate: 'pageState', dateFields: ['discoveredAt', 'visitedAt'], jsonFields: [] },
  actions: { delegate: 'actionRecord', dateFields: ['startedAt'], jsonFields: ['element', 'signals'] },
  findings: {
    delegate: 'finding',
    dateFields: ['firstSeenAt', 'lastSeenAt'],
    jsonFields: ['calculation', 'reproduction', 'evidence'],
  },
  evidence: { delegate: 'evidence', dateFields: ['createdAt'], jsonFields: ['metadata'] },
  snapshots: { delegate: 'metricSnapshot', dateFields: ['capturedAt'], jsonFields: ['metrics', 'table'] },
  filterDimensions: { delegate: 'filterDimension', dateFields: [], jsonFields: ['options'] },
  filterCombinations: {
    delegate: 'filterCombination',
    dateFields: ['plannedAt', 'executedAt'],
    jsonFields: ['selections'],
  },
  checks: { delegate: 'checkResult', dateFields: ['createdAt'], jsonFields: ['calculation'] },
  vault: {
    delegate: 'sessionVault',
    dateFields: ['createdAt', 'expiresAt', 'lastUsedAt', 'revokedAt'],
    jsonFields: [],
  },
  jobs: {
    delegate: 'jobRecord',
    dateFields: ['createdAt', 'updatedAt', 'startedAt', 'finishedAt'],
    jsonFields: ['payload'],
  },
  logs: { delegate: 'runLog', dateFields: ['at'], jsonFields: ['data'] },
  audit: { delegate: 'auditLog', dateFields: ['at'], jsonFields: ['detail'] },
  aiDecisions: { delegate: 'aiDecision', dateFields: ['at'], jsonFields: [] },
};

type Row = Record<string, unknown>;
type AnyRecord = Record<string, unknown>;

interface PrismaDelegate {
  findUnique(args: { where: { id: string } }): Promise<Row | null>;
  findMany(args: Record<string, unknown>): Promise<Row[]>;
  create(args: { data: Row }): Promise<Row>;
  update(args: { where: { id: string }; data: Row }): Promise<Row>;
  delete(args: { where: { id: string } }): Promise<unknown>;
  count(args?: Record<string, unknown>): Promise<number>;
}

interface PrismaClientLike {
  $disconnect(): Promise<void>;
  [delegate: string]: PrismaDelegate | ((...args: never[]) => unknown) | unknown;
}

function isRange(value: unknown): value is Record<string, string | number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => ['lt', 'lte', 'gt', 'gte'].includes(key));
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function deepCloneJson(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

class PrismaRepository<T extends { id: string }> implements Repository<T> {
  constructor(
    private readonly client: PrismaClientLike,
    private readonly spec: CollectionSpec,
    private readonly label: string,
  ) {}

  private get delegate(): PrismaDelegate {
    const delegate = this.client[this.spec.delegate];
    if (!delegate || typeof delegate === 'function') {
      throw new Error(`Prisma delegate "${this.spec.delegate}" is unavailable for ${this.label}`);
    }
    return delegate as PrismaDelegate;
  }

  private toRow(entity: Partial<T>, { forCreate }: { forCreate: boolean }): Row {
    const row: Row = {};
    for (const [key, value] of Object.entries(entity as AnyRecord)) {
      if (value === undefined) continue;
      if (this.spec.dateFields.includes(key)) {
        row[key] = toDate(value);
        continue;
      }
      if (this.spec.jsonFields.includes(key)) {
        row[key] = deepCloneJson(value) ?? null;
        continue;
      }
      row[key] = value;
    }
    if (forCreate && !row.id) throw new Error(`${this.label}: create requires an id`);
    return row;
  }

  private fromRow(row: Row): T {
    const entity: AnyRecord = {};
    for (const [key, value] of Object.entries(row)) {
      entity[key] = value instanceof Date ? value.toISOString() : value;
    }
    return entity as T;
  }

  private toWhere(where: Record<string, FilterValue | undefined> = {}): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(where)) {
      if (value === undefined) continue;
      const isDate = this.spec.dateFields.includes(key);
      if (Array.isArray(value)) {
        out[key] = { in: value.map((item) => (isDate ? toDate(item) : item)) };
        continue;
      }
      if (isRange(value)) {
        const range: Record<string, unknown> = {};
        for (const [op, bound] of Object.entries(value)) {
          if (bound === undefined) continue;
          range[op] = isDate ? toDate(bound) : bound;
        }
        out[key] = range;
        continue;
      }
      if (value && typeof value === 'object' && 'not' in value) {
        out[key] = { not: (value as { not: unknown }).not };
        continue;
      }
      out[key] = isDate ? toDate(value) : value;
    }
    return out;
  }

  async create(entity: T): Promise<T> {
    const row = await this.delegate.create({ data: this.toRow(entity, { forCreate: true }) });
    return this.fromRow(row);
  }

  async createMany(entities: T[]): Promise<T[]> {
    const results: T[] = [];
    // Prisma createMany does not return rows on every provider version; a
    // sequential create keeps the API honest for QA volumes (<10k rows/run).
    for (const entity of entities) results.push(await this.create(entity));
    return results;
  }

  async get(id: string): Promise<T | null> {
    const row = await this.delegate.findUnique({ where: { id } });
    return row ? this.fromRow(row) : null;
  }

  async update(id: string, patch: Partial<T>): Promise<T> {
    const row = await this.delegate.update({ where: { id }, data: this.toRow(patch, { forCreate: false }) });
    return this.fromRow(row);
  }

  async delete(id: string): Promise<void> {
    await this.delegate.delete({ where: { id } });
  }

  async find(query: FindQuery = {}): Promise<T[]> {
    const orderField = query.orderBy?.field ?? 'createdAt';
    const direction = query.orderBy?.direction ?? 'desc';
    const rows = await this.delegate.findMany({
      where: this.toWhere(query.where),
      orderBy: { [orderField]: direction },
      skip: query.offset ?? 0,
      take: query.limit ?? 1_000,
    });
    return rows.map((row) => this.fromRow(row));
  }

  async count(where: Record<string, FilterValue | undefined> = {}): Promise<number> {
    return this.delegate.count({ where: this.toWhere(where) });
  }
}

export async function createPrismaStore(databaseUrl?: string): Promise<Store> {
  if (!databaseUrl) throw new Error('DATABASE_URL is required when STORAGE_DRIVER=postgres');
  const { PrismaClient } = (await import('@prisma/client')) as unknown as {
    PrismaClient: new (options?: unknown) => PrismaClientLike;
  };
  const client = new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: ['warn', 'error'] });

  const repo = <T extends { id: string }>(collection: keyof typeof SPECS): Repository<T> => {
    const spec = SPECS[collection];
    if (!spec) throw new Error(`No Prisma mapping for ${String(collection)}`);
    return new PrismaRepository<T>(client, spec, String(collection));
  };

  return {
    driver: 'postgres',
    users: repo('users'),
    authSessions: repo('authSessions'),
    sites: repo('sites'),
    runs: repo('runs'),
    pages: repo('pages'),
    actions: repo('actions'),
    findings: repo('findings'),
    evidence: repo('evidence'),
    snapshots: repo('snapshots'),
    filterDimensions: repo('filterDimensions'),
    filterCombinations: repo('filterCombinations'),
    checks: repo('checks'),
    vault: repo('vault'),
    jobs: repo('jobs'),
    logs: repo('logs'),
    audit: repo('audit'),
    aiDecisions: repo('aiDecisions'),
    async close() {
      await client.$disconnect();
    },
  };
}
