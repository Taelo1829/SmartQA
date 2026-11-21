import { z } from 'zod';
import { RUN_MODES, VIEWPORTS } from './types';

const budgetsSchema = z.object({
  maxPages: z.number().int().min(1).max(200),
  maxActions: z.number().int().min(5).max(2000),
  maxDepth: z.number().int().min(1).max(10),
  actionsPerPage: z.number().int().min(1).max(60),
  maxFilterCombinations: z.number().int().min(0).max(200),
  maxDurationMs: z.number().int().min(30_000).max(60 * 60_000),
});

export const createRunSchema = z.object({
  url: z
    .string()
    .min(4)
    .max(2048)
    .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://'),
  mode: z.enum(RUN_MODES).default('background'),
  requireAuth: z.boolean().default(false),
  viewports: z.array(z.enum(VIEWPORTS)).min(1).max(2).default(['desktop']),
  budgets: budgetsSchema.partial().optional(),
  seed: z.number().int().min(0).max(2 ** 31 - 1).optional(),
  allowDestructiveActions: z.boolean().default(false),
  approvedActionPatterns: z.array(z.string().max(200)).max(20).default([]),
  focus: z.enum(['full', 'navigation', 'dashboard', 'forms']).default('full'),
  captureScreenshots: z.boolean().default(true),
  recordTrace: z.boolean().default(true),
  reproductionAttempts: z.number().int().min(0).max(5).default(2),
  notes: z.string().max(2000).optional(),
  /** Explicit attestation that the operator owns or is authorised to test the site. */
  authorizationConfirmed: z.literal(true),
});

export type CreateRunInput = z.input<typeof createRunSchema>;
export type CreateRunPayload = z.output<typeof createRunSchema>;

export const RUN_ACTIONS = [
  'start',
  'pause',
  'resume',
  'stop',
  'takeover',
  'release',
  'detach',
  'login_complete',
  'reproduce',
] as const;
export type RunActionName = (typeof RUN_ACTIONS)[number];

export const runActionSchema = z.object({
  action: z.enum(RUN_ACTIONS),
  findingId: z.string().optional(),
});

export const credentialsSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(120).optional(),
});

export const registerSchema = credentialsSchema.extend({
  name: z.string().min(1).max(120),
});

const mouseEventSchema = z.object({
  type: z.literal('mouse'),
  event: z.enum(['mousePressed', 'mouseReleased', 'mouseMoved', 'mouseWheel']),
  x: z.number().min(0).max(10000),
  y: z.number().min(0).max(10000),
  button: z.enum(['left', 'right', 'middle', 'none']).default('left'),
  clickCount: z.number().int().min(0).max(3).default(1),
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  modifiers: z.number().int().min(0).max(15).default(0),
});

const keyEventSchema = z.object({
  type: z.literal('key'),
  event: z.enum(['keyDown', 'keyUp', 'char']),
  key: z.string().max(64),
  code: z.string().max(64).optional(),
  text: z.string().max(4096).optional(),
  modifiers: z.number().int().min(0).max(15).default(0),
});

const typeEventSchema = z.object({
  type: z.literal('type'),
  text: z.string().max(4096),
});

const scrollEventSchema = z.object({
  type: z.literal('scroll'),
  x: z.number().min(0).max(10000),
  y: z.number().min(0).max(10000),
  deltaX: z.number().min(-10000).max(10000),
  deltaY: z.number().min(-10000).max(10000),
});

export const liveInputSchema = z.discriminatedUnion('type', [
  mouseEventSchema,
  keyEventSchema,
  typeEventSchema,
  scrollEventSchema,
]);
export type LiveInput = z.infer<typeof liveInputSchema>;

export const listRunsQuerySchema = z.object({
  status: z.string().optional(),
  mode: z.enum(RUN_MODES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(0).max(10_000).default(0),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});

/** The LLM planner may only ever return one of these bounded decisions. */
export const plannerDecisionSchema = z.object({
  action: z.enum(['explore', 'test_dashboard', 'report', 'stop']),
  targetActionId: z.string().optional(),
  reason: z.string().max(600),
  confidence: z.number().min(0).max(1),
});
export type PlannerDecision = z.infer<typeof plannerDecisionSchema>;

export const metricInterpretationSchema = z.object({
  additivity: z.enum(['additive', 'non_additive', 'unknown']),
  reason: z.string().max(400),
  confidence: z.number().min(0).max(1),
});
export type MetricInterpretation = z.infer<typeof metricInterpretationSchema>;
