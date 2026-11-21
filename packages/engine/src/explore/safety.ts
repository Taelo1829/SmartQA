import { DESTRUCTIVE_PATTERNS, SAFE_LABEL_ALLOWLIST } from '@smartqa/shared';
import type { ElementCategory } from '@smartqa/shared';

/**
 * Destructive-action policy.
 *
 * The agent is never allowed to delete data, move money, contact third parties
 * or modify production records unless the operator explicitly opted in *and*
 * (for extra safety) the label matched an approved pattern.
 */

export type RiskLevel = 'none' | 'possible' | 'blocked';

export interface RiskAssessment {
  risk: RiskLevel;
  reason: string | null;
  matchedPattern?: string | null;
}

export interface RiskInput {
  label: string;
  detail?: string | null;
  category: ElementCategory;
  href?: string | null;
  inputType?: string | null;
  targetOrigin: string;
  allowDestructive: boolean;
  approvedPatterns: string[];
}

const ENDPOINT_TARGET = /^(https?:)?\/\//i;

export function assessActionRisk(input: RiskInput): RiskAssessment {
  const haystack = `${input.label} ${input.detail ?? ''}`.toLowerCase().replace(/\s+/g, ' ').trim();

  if (input.inputType === 'file') {
    return { risk: 'blocked', reason: 'File uploads could exfiltrate local data; skipped.' };
  }

  if (input.href && ENDPOINT_TARGET.test(input.href)) {
    try {
      const target = new URL(input.href, input.targetOrigin);
      if (target.origin !== input.targetOrigin) {
        return { risk: 'blocked', reason: `External navigation to ${target.origin} is out of scope.` };
      }
    } catch {
      return { risk: 'blocked', reason: 'Unparseable link target.' };
    }
  }
  if (input.href && /^(mailto|tel|sms|javascript):/i.test(input.href)) {
    return { risk: 'blocked', reason: 'Non-navigational link scheme.' };
  }

  const approved = input.approvedPatterns.find((pattern) => {
    try {
      return new RegExp(pattern, 'i').test(haystack);
    } catch {
      return false;
    }
  });

  if (input.allowDestructive) {
    return { risk: 'none', reason: approved ? 'Explicitly approved pattern.' : 'Destructive testing enabled by operator.' };
  }

  const safe = SAFE_LABEL_ALLOWLIST.some((pattern) => pattern.test(haystack));
  if (safe) return { risk: 'none', reason: null };

  if (approved) return { risk: 'none', reason: 'Matches an operator-approved action pattern.' };

  const match = DESTRUCTIVE_PATTERNS.find((pattern) => pattern.test(haystack));
  if (match) {
    return {
      risk: 'blocked',
      reason: `Matches destructive-operation policy (${match.source}). Blocked unless explicitly approved.`,
      matchedPattern: match.source,
    };
  }

  if (input.category === 'button' || input.category === 'input' || input.category === 'other') {
    if (/\b(submit|save|apply|update|confirm|ok|create|add)\b/i.test(haystack)) {
      return {
        risk: 'possible',
        reason: 'May change persisted data; executed only for search/filter or approved flows.',
      };
    }
  }

  return { risk: 'none', reason: null };
}

/** Heuristic: does this snapshot look like a login wall? */
export function looksLikeAuthWall(input: {
  passwordFieldCount: number;
  text: string;
  url: string;
  hasLoginForm: boolean;
}): boolean {
  if (input.passwordFieldCount > 0) return true;
  if (input.hasLoginForm && /sign in|log in|login|authenticate/i.test(input.text)) return true;
  if (/\/login|\/signin|\/sign-in|\/auth/i.test(input.url) && /password|email/i.test(input.text)) return true;
  return false;
}
