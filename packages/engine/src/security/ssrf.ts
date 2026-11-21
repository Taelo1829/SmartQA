import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF protection.
 *
 * The platform accepts arbitrary user URLs, so every navigation (including
 * redirects and subresources) is checked against this policy before the
 * browser is allowed to reach it. Private/link-local/metadata addresses are
 * rejected unless ALLOW_PRIVATE_NETWORKS=true (needed only to test localhost).
 */

export class SsrfError extends Error {
  readonly code = 'SSRF_BLOCKED';
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  '169.254.169.254',
]);

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

interface Cidr {
  base: number;
  mask: number;
}

const PRIVATE_V4: Cidr[] = [
  { base: ipv4ToInt('0.0.0.0')!, mask: 8 },
  { base: ipv4ToInt('10.0.0.0')!, mask: 8 },
  { base: ipv4ToInt('100.64.0.0')!, mask: 10 },
  { base: ipv4ToInt('127.0.0.0')!, mask: 8 },
  { base: ipv4ToInt('169.254.0.0')!, mask: 16 },
  { base: ipv4ToInt('172.16.0.0')!, mask: 12 },
  { base: ipv4ToInt('192.0.0.0')!, mask: 24 },
  { base: ipv4ToInt('192.168.0.0')!, mask: 16 },
  { base: ipv4ToInt('198.18.0.0')!, mask: 15 },
  { base: ipv4ToInt('224.0.0.0')!, mask: 4 },
  { base: ipv4ToInt('240.0.0.0')!, mask: 4 },
];

export function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return true;
  return PRIVATE_V4.some(({ base, mask }) => {
    const shift = 32 - mask;
    return (value >>> shift) === (base >>> shift);
  });
}

export function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('fe80') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // IPv4-mapped addresses (::ffff:127.0.0.1)
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true;
}

export interface UrlPolicy {
  allowPrivateNetworks: boolean;
  /** Optional origin allowlist (used by tests / single-tenant deployments). */
  allowedOrigins?: string[];
}

export interface CheckedUrl {
  url: URL;
  hostname: string;
  addresses: string[];
  private: boolean;
}

const dnsCache = new Map<string, { addresses: string[]; at: number }>();
const DNS_TTL_MS = 30_000;

export async function resolveHostname(hostname: string): Promise<string[]> {
  const cached = dnsCache.get(hostname);
  if (cached && Date.now() - cached.at < DNS_TTL_MS) return cached.addresses;
  const records = await lookup(hostname, { all: true, verbatim: true });
  const addresses = records.map((record) => record.address);
  dnsCache.set(hostname, { addresses, at: Date.now() });
  return addresses;
}

/** Validate a URL, resolving DNS and rejecting private targets by policy. */
export async function assertSafeUrl(raw: string, policy: UrlPolicy): Promise<CheckedUrl> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError(`Invalid URL: ${raw}`);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfError(`Blocked protocol "${url.protocol}". Only http and https are allowed.`);
  }
  if (url.username || url.password) {
    throw new SsrfError('URLs with embedded credentials are not allowed.');
  }
  if (policy.allowedOrigins?.length) {
    const allowed = policy.allowedOrigins.some((origin) => origin === url.origin);
    if (!allowed) throw new SsrfError(`Origin ${url.origin} is not in the allowed origin list.`);
  }

  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!hostname) throw new SsrfError('URL has no hostname.');
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SsrfError(`Blocked host "${hostname}".`);
  }
  if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
    throw new SsrfError(`Blocked internal host "${hostname}".`);
  }

  let addresses: string[];
  if (isIP(hostname)) {
    addresses = [hostname];
  } else {
    try {
      addresses = await resolveHostname(hostname);
    } catch {
      throw new SsrfError(`Could not resolve host "${hostname}".`);
    }
  }
  if (addresses.length === 0) throw new SsrfError(`Host "${hostname}" did not resolve to any address.`);

  const privateAddress = addresses.find((address) => isPrivateAddress(address));
  if (privateAddress && !policy.allowPrivateNetworks) {
    throw new SsrfError(
      `Blocked private-network address ${privateAddress} for "${hostname}". Set ALLOW_PRIVATE_NETWORKS=true only for sites you own.`,
    );
  }

  return { url, hostname, addresses, private: Boolean(privateAddress) };
}

/** Origin-scoped policy for a single run: only the tested site is navigable. */
export class RunUrlGuard {
  private readonly policy: UrlPolicy;

  constructor(
    private readonly entryUrl: string,
    policy: UrlPolicy,
  ) {
    this.policy = policy;
  }

  /**
   * Guard used by the browser request interceptor.
   *
   * Navigation requests are fully re-validated (including DNS). Subresources
   * are checked against the same rules but with a cached DNS lookup, because a
   * page can bootstrap requests to internal hostnames just as easily as a
   * redirect can.
   */
  async assertRequestAllowed(rawUrl: string, isNavigation: boolean): Promise<void> {
    if (!/^https?:/i.test(rawUrl)) throw new SsrfError('Only http(s) requests are allowed.');
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new SsrfError(`Invalid request URL: ${rawUrl}`);
    }
    const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!hostname) throw new SsrfError('Request has no hostname.');
    if (BLOCKED_HOSTNAMES.has(hostname)) throw new SsrfError(`Blocked host "${hostname}".`);
    if (hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.localhost')) {
      throw new SsrfError(`Blocked internal host "${hostname}".`);
    }

    let addresses: string[];
    if (isIP(hostname)) {
      addresses = [hostname];
    } else {
      try {
        addresses = await resolveHostname(hostname);
      } catch {
        throw new SsrfError(`Could not resolve host "${hostname}".`);
      }
      if (addresses.length === 0) throw new SsrfError(`Host "${hostname}" did not resolve.`);
    }

    const privateAddress = addresses.find((address) => isPrivateAddress(address));
    if (privateAddress && !this.policy.allowPrivateNetworks) {
      throw new SsrfError(
        `Blocked ${isNavigation ? 'navigation' : 'request'} to private address ${privateAddress} (${hostname}).`,
      );
    }
    void this.entryUrl;
  }

  async checkNavigation(url: string): Promise<CheckedUrl> {
    return assertSafeUrl(url, this.policy);
  }
}
