import type { NextConfig } from 'next';
import { Worker } from 'node:worker_threads';

const PATCH_FLAG = Symbol.for('smartqa.workerPostMessagePatch');

function withoutFunctions(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === 'function') return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);

  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) {
    return value;
  }

  if (value instanceof Map) {
    const mapCopy = new Map();
    seen.set(value, mapCopy);
    for (const [key, entry] of value) {
      mapCopy.set(withoutFunctions(key, seen), withoutFunctions(entry, seen));
    }
    return mapCopy;
  }

  if (value instanceof Set) {
    const setCopy = new Set();
    seen.set(value, setCopy);
    for (const entry of value) {
      setCopy.add(withoutFunctions(entry, seen));
    }
    return setCopy;
  }

  if (Array.isArray(value)) {
    const arrayCopy: unknown[] = [];
    seen.set(value, arrayCopy);
    for (const entry of value) {
      arrayCopy.push(withoutFunctions(entry, seen));
    }
    return arrayCopy;
  }

  const objectCopy: Record<string, unknown> = {};
  seen.set(value, objectCopy);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    objectCopy[key] = withoutFunctions((value as Record<string, unknown>)[key], seen);
  }
  return objectCopy;
}

if (!(globalThis as Record<symbol, unknown>)[PATCH_FLAG]) {
  (globalThis as Record<symbol, unknown>)[PATCH_FLAG] = true;
  const originalPostMessage = Worker.prototype.postMessage;

  Worker.prototype.postMessage = function postMessage(this: Worker, value: unknown, transferList?: any) {
    try {
      return originalPostMessage.call(this, value, transferList);
    } catch (error: any) {
      if (error && error.name === 'DataCloneError') {
        return originalPostMessage.call(
          this,
          withoutFunctions(value, new WeakMap()),
          transferList
        );
      }
      throw error;
    }
  };
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@smartqa/shared', '@smartqa/db', '@smartqa/engine', '@smartqa/jobs'],
  serverExternalPackages: ['playwright', '@prisma/client', 'bullmq', 'ioredis'],
  typescript: {
    ignoreBuildErrors: true,
  },
  experimental: {
    workerThreads: true,
    webpackBuildWorker: false,
  },
};

export default nextConfig;
