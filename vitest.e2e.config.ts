import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.e2e.test.ts'],
    pool: 'threads',
    poolOptions: { threads: { singleThread: true } },
    testTimeout: 120_000,
    setupFiles: ['tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@smartqa/shared': path.resolve(__dirname, 'packages/shared/src/index.ts'),
      '@smartqa/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
      '@smartqa/engine': path.resolve(__dirname, 'packages/engine/src/index.ts'),
      '@smartqa/jobs': path.resolve(__dirname, 'packages/jobs/src/index.ts'),
    },
  },
});
