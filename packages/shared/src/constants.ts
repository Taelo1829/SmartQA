/**
 * Safety constants shared by the web app and the engine.
 */

/**
 * Operations that are blocked by default because they can destroy data,
 * move money, or contact third parties. A match blocks the interaction unless
 * the operator explicitly enabled destructive testing for the run.
 *
 * Matching is done on a normalised, lower-cased label + element metadata.
 */
export const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bdelete\b/,
  /\bremove\b.*\b(account|user|workspace|project)\b/,
  /\bdestroy\b/,
  /\bdeactivate\b/,
  /\bpurchase\b/,
  /\bbuy\b/,
  /\bcheckout\b/,
  /\bpay\b/,
  /\bpayment\b/,
  /\bplace\s+order\b/,
  /\btransfer\b/,
  /\bwithdraw\b/,
  /\bsend\s+(message|email|invite|sms|notification)\b/,
  /\binvite\b/,
  /\bunsubscribe\b/,
  /\bcancel\s+(subscription|plan|account|order)\b/,
  /\bconfirm\s+order\b/,
  /\barchive\b/,
  /\bclose\s+account\b/,
  /\breset\s+password\b/,
  /\bchange\s+password\b/,
  /\bsign\s+out\b/,
  /\blog\s*out\b/,
  /\bsubmit\b.*\bapplication\b/,
  /\bpublish\b/,
  /\bdeploy\b/,
];

/** Labels that are safe and useful even though they look state-changing. */
export const SAFE_LABEL_ALLOWLIST: RegExp[] = [
  /\bsearch\b/,
  /\bfilter\b/,
  /\bapply\b/,
  /\breset\s+filters?\b/,
  /\bclear\s+filters?\b/,
  /\bnext\b/,
  /\bprevious\b/,
  /\bpage\s+\d+/,
  /\bsort\b/,
  /\bexpand\b/,
  /\bcollapse\b/,
  /\bclose\b/,
  /\bcancel\b/,
  /\bview\b/,
  /\bdetails?\b/,
  /\bedit\b/,
  /\bexport\b/,
  /\bdownload\b/,
  /\brefresh\b/,
];

/** Path segments that usually indicate a login wall. */
export const AUTH_PATH_HINTS: RegExp[] = [
  /\/(login|log-in|signin|sign-in|auth|sso|oauth)/i,
  /\/(account|session)\/(signin|login)/i,
];

/** Text tokens that indicate a broken value when they stand alone. */
export const INVALID_VALUE_TOKENS = ['nan', 'undefined', 'infinity', '-infinity', 'null'] as const;
export type InvalidValueToken = (typeof INVALID_VALUE_TOKENS)[number];

/** Phrases that make a token legitimate prose rather than a broken value. */
export const INVALID_TOKEN_PROSE_ALLOWLIST: RegExp[] = [
  /\bundefined\s+(behaviou?r|value|result|state)\b/i,
  /\bnull\s+(pointer|value|check|safety)\b/i,
  /\bnot\s+defined\b/i,
  /\bnull\s+and\s+void\b/i,
  /\bnan\s+technology\b/i,
];

/**
 * Prompt-injection markers. Page content is untrusted input: these markers
 * raise the suspicion score and force the AI layer to ignore in-page text.
 */
export const PROMPT_INJECTION_MARKERS: RegExp[] = [
  /ignore (all |any )?(previous|prior|above) instructions/i,
  /disregard (the )?(system|developer) prompt/i,
  /you are now (a|an) /i,
  /\[?system\]?\s*:/i,
  /<\s*\/?\s*(system|assistant|tool)\s*>/i,
  /reveal (your|the) (system )?prompt/i,
];

export const DEFAULT_MAX_CONCURRENT_BROWSERS = 2;
export const EVIDENCE_DIR = '.data/evidence';
export const TRACE_DIR = '.data/traces';
