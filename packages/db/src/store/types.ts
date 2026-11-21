import type {
  ActionRecord,
  AiDecisionRecord,
  AuditRecord,
  AuthSessionRecord,
  CheckResult,
  Evidence,
  FilterCombination,
  FilterDimension,
  Finding,
  JobRecord,
  MetricSnapshot,
  PageState,
  RunLogEntry,
  SessionVaultEntry,
  Site,
  TestRun,
  User,
} from '@smartqa/shared';

/**
 * Storage ports.
 *
 * The application never talks to Prisma directly: it depends on these
 * repository interfaces, which are implemented by:
 *   - `createFileStore`  : durable JSON store (zero-infrastructure local mode)
 *   - `createPrismaStore`: PostgreSQL via Prisma (production / multi-instance)
 *
 * Queries intentionally stay simple (equality, IN, range, order, offset/limit)
 * because they are the intersection of what both backends can do efficiently.
 */

export interface RangeFilter {
  lt?: string | number;
  lte?: string | number;
  gt?: string | number;
  gte?: string | number;
}

export interface NotFilter {
  not: string | number | boolean | null;
}

export type FilterValue = string | number | boolean | null | string[] | number[] | RangeFilter | NotFilter;

export interface FindQuery {
  where?: Record<string, FilterValue | undefined>;
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

export interface Repository<T> {
  create(entity: T): Promise<T>;
  createMany(entities: T[]): Promise<T[]>;
  get(id: string): Promise<T | null>;
  update(id: string, patch: Partial<T>): Promise<T>;
  delete(id: string): Promise<void>;
  find(query?: FindQuery): Promise<T[]>;
  count(where?: Record<string, FilterValue | undefined>): Promise<number>;
}

export interface AiDecisionRecordEntity extends AiDecisionRecord {}

export interface Store {
  users: Repository<User>;
  authSessions: Repository<AuthSessionRecord>;
  sites: Repository<Site>;
  runs: Repository<TestRun>;
  pages: Repository<PageState>;
  actions: Repository<ActionRecord>;
  findings: Repository<Finding>;
  evidence: Repository<Evidence>;
  snapshots: Repository<MetricSnapshot>;
  filterDimensions: Repository<FilterDimension>;
  filterCombinations: Repository<FilterCombination>;
  checks: Repository<CheckResult>;
  vault: Repository<SessionVaultEntry>;
  jobs: Repository<JobRecord>;
  logs: Repository<RunLogEntry>;
  audit: Repository<AuditRecord>;
  aiDecisions: Repository<AiDecisionRecord>;
  /** Backend identifier, surfaced in /api/health. */
  readonly driver: 'file' | 'postgres';
  close(): Promise<void>;
}

export type CollectionName = Exclude<keyof Store, 'driver' | 'close'>;
