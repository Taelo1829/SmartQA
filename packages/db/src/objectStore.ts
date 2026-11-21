import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Object storage for evidence (screenshots, traces, DOM dumps).
 *
 * The interface is deliberately S3-shaped so the local filesystem adapter can
 * be replaced by an S3/MinIO adapter in production without touching callers.
 * Object keys are server-generated, never user-controlled.
 */

export interface StoredObject {
  key: string;
  sizeBytes: number;
  checksum: string;
  contentType: string;
}

export interface ObjectStore {
  put(key: string, data: Buffer | string, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<{ data: Buffer; contentType: string }>;
  stat(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  readonly driver: string;
}

function checksumOf(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.html': 'text/html',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
};

export class LocalObjectStore implements ObjectStore {
  readonly driver = 'filesystem';

  constructor(private readonly baseDir: string) {}

  /** Resolve a key inside the store root, rejecting traversal and absolute keys. */
  private resolveKey(key: string): string {
    const normalized = key.replace(/\\/g, '/').replace(/^\/+/, '');
    if (normalized.includes('..') || normalized === '') throw new Error(`Invalid object key: ${key}`);
    const target = path.resolve(this.baseDir, normalized);
    const root = path.resolve(this.baseDir);
    if (!target.startsWith(root + path.sep)) throw new Error(`Object key escapes storage root: ${key}`);
    return target;
  }

  async put(key: string, data: Buffer | string, contentType: string): Promise<StoredObject> {
    const target = this.resolveKey(key);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return { key, sizeBytes: buffer.length, checksum: checksumOf(buffer), contentType };
  }

  async get(key: string): Promise<{ data: Buffer; contentType: string }> {
    const target = this.resolveKey(key);
    const data = await readFile(target);
    const ext = path.extname(target).toLowerCase();
    return { data, contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream' };
  }

  async stat(key: string): Promise<StoredObject | null> {
    try {
      const target = this.resolveKey(key);
      const info = await stat(target);
      const data = await readFile(target);
      return {
        key,
        sizeBytes: info.size,
        checksum: checksumOf(data),
        contentType: CONTENT_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.resolveKey(key));
    } catch {
      /* idempotent delete */
    }
  }
}

/**
 * S3-compatible adapter placeholder.
 *
 * Intentionally not implemented: wiring an S3 SDK without credentials in this
 * environment would be untestable. The interface above is the seam; see
 * docs/ARCHITECTURE.md ("Replacing the object store").
 */
export function createObjectStore(dataDir: string): ObjectStore {
  return new LocalObjectStore(path.join(dataDir, 'evidence'));
}
