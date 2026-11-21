import type { LiveInput, RunActionName } from '@smartqa/shared/schemas';
import type {
  ApiError,
  CreateRunResponse,
  ExplorationFocus,
  HealthResponse,
  PublicUser,
  RunBudgets,
  RunDetailResponse,
  RunListResponse,
  RunMode,
  RunReport,
  RunStatus,
  TestRun,
  ViewportName,
} from '@smartqa/shared/types';

/**
 * `liveSessionId` is returned alongside the run detail payload but is not part
 * of the shared `RunDetailResponse` type, so the web app widens it locally.
 */
export interface RunDetail extends RunDetailResponse {
  liveSessionId?: string | null;
}

/** Live-viewer descriptor served by `GET /api/live/:sessionId`. */
export interface LiveSessionInfo {
  id: string;
  runId: string;
  status: string;
  viewport: { width: number; height: number };
  interactive: boolean;
  viewerCount: number;
  startedAt: string;
}

export interface CreateRunRequest {
  url: string;
  mode: RunMode;
  requireAuth: boolean;
  viewports: ViewportName[];
  budgets: RunBudgets;
  seed: number;
  allowDestructiveActions: boolean;
  approvedActionPatterns: string[];
  focus: ExplorationFocus;
  captureScreenshots: boolean;
  recordTrace: boolean;
  reproductionAttempts: number;
  notes?: string;
  authorizationConfirmed: true;
}

export interface RunListQuery {
  limit?: number;
  status?: RunStatus | 'all';
  mode?: RunMode | 'all';
}

export interface RunActionRequest {
  action: RunActionName;
  findingId?: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  signal?: AbortSignal;
  redirectOnUnauthorized?: boolean;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    message: string,
    options: { code?: string; status?: number; details?: unknown } = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.code = options.code ?? 'request_failed';
    this.status = options.status ?? 0;
    this.details = options.details;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;
  window.location.assign('/login');
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function extractError(
  payload: unknown,
  fallback: string,
): { message: string; code: string; details?: unknown } {
  if (typeof payload === 'object' && payload !== null) {
    const candidate = payload as Partial<ApiError>;
    const message =
      typeof candidate.error === 'string' && candidate.error.length > 0
        ? candidate.error
        : fallback;
    const code =
      typeof candidate.code === 'string' && candidate.code.length > 0
        ? candidate.code
        : 'request_failed';
    return { message, code, details: candidate.details };
  }
  return { message: fallback, code: 'request_failed' };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, redirectOnUnauthorized = true } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      cache: 'no-store',
      signal,
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiClientError(
      'Could not reach the SmartQA API. Check that the web server is running, then retry.',
      { code: 'network_error' },
    );
  }

  if (response.status === 401) {
    if (redirectOnUnauthorized) redirectToLogin();
    throw new ApiClientError('Your session has expired. Sign in to continue.', {
      code: 'unauthorized',
      status: 401,
    });
  }

  const payload = await readPayload(response);

  if (!response.ok) {
    const fallback = `Request failed (${response.status} ${response.statusText || 'error'}).`;
    const extracted = extractError(payload, fallback);
    throw new ApiClientError(extracted.message, {
      code: extracted.code,
      status: response.status,
      details: extracted.details,
    });
  }

  return payload as T;
}

function runsQueryString(query: RunListQuery): string {
  const params = new URLSearchParams();
  if (query.limit != null) params.set('limit', String(query.limit));
  if (query.status && query.status !== 'all') params.set('status', query.status);
  if (query.mode && query.mode !== 'all') params.set('mode', query.mode);
  const serialized = params.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

export function runEventsUrl(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/events`;
}

export function liveStreamUrl(sessionId: string): string {
  return `/api/live/${encodeURIComponent(sessionId)}/stream`;
}

export function evidenceUrl(runId: string, evidenceId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(evidenceId)}`;
}

export function exportUrl(runId: string, format: 'json' | 'pdf'): string {
  return `/api/runs/${encodeURIComponent(runId)}/export/${format}`;
}

export const api = {
  health(signal?: AbortSignal): Promise<HealthResponse> {
    return request<HealthResponse>('/api/health', {
      signal,
      redirectOnUnauthorized: false,
    });
  },

  me(
    options: { signal?: AbortSignal; redirectOnUnauthorized?: boolean } = {},
  ): Promise<{ user: PublicUser }> {
    return request<{ user: PublicUser }>('/api/auth/me', {
      signal: options.signal,
      redirectOnUnauthorized: options.redirectOnUnauthorized ?? true,
    });
  },

  login(input: { email: string; password: string }): Promise<{ user: PublicUser }> {
    return request<{ user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: input,
      redirectOnUnauthorized: false,
    });
  },

  register(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<{ user: PublicUser }> {
    return request<{ user: PublicUser }>('/api/auth/register', {
      method: 'POST',
      body: input,
      redirectOnUnauthorized: false,
    });
  },

  logout(): Promise<{ ok: true }> {
    return request<{ ok: true }>('/api/auth/logout', { method: 'POST' });
  },

  listRuns(
    query: RunListQuery = {},
    signal?: AbortSignal,
  ): Promise<{ runs: TestRun[]; total: number }> {
    return request<RunListResponse>(`/api/runs${runsQueryString(query)}`, { signal });
  },

  createRun(input: CreateRunRequest): Promise<CreateRunResponse> {
    return request<CreateRunResponse>('/api/runs', { method: 'POST', body: input });
  },

  getRun(runId: string, signal?: AbortSignal): Promise<RunDetail> {
    return request<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`, { signal });
  },

  runAction(runId: string, input: RunActionRequest): Promise<{ run: TestRun }> {
    return request<{ run: TestRun }>(`/api/runs/${encodeURIComponent(runId)}/actions`, {
      method: 'POST',
      body: input,
    });
  },

  getReport(runId: string, signal?: AbortSignal): Promise<RunReport> {
    return request<RunReport>(`/api/runs/${encodeURIComponent(runId)}/report`, { signal });
  },

  getLiveSession(sessionId: string, signal?: AbortSignal): Promise<LiveSessionInfo> {
    return request<LiveSessionInfo>(`/api/live/${encodeURIComponent(sessionId)}`, {
      signal,
    });
  },

  sendLiveInput(sessionId: string, input: LiveInput): Promise<{ ok: true }> {
    return request<{ ok: true }>(`/api/live/${encodeURIComponent(sessionId)}/input`, {
      method: 'POST',
      body: input,
    });
  },
};
