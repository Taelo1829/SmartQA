import type { AiDecisionRecord, AuditRecord } from '@smartqa/shared';

/**
 * Small additions that live in the db package because they are persisted but
 * not part of the public API surface.
 */
export interface AuditRecordEntity extends AuditRecord {}

export interface CreateAuditInput {
  userId?: string | null;
  runId?: string | null;
  action: string;
  detail?: Record<string, unknown> | null;
  ip?: string | null;
}

export type { AiDecisionRecord };
