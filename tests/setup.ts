import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Test environment: isolated data directory, deterministic encryption key,
 * no LLM calls. Each test file gets its own temp directory.
 */
const dataDir = mkdtempSync(path.join(tmpdir(), 'smartqa-test-'));
process.env.SMARTQA_DATA_DIR = dataDir;
process.env.SESSION_ENCRYPTION_KEY = 'test-key-0123456789abcdef0123456789abcdef';
process.env.STORAGE_DRIVER = 'file';
process.env.QUEUE_DRIVER = 'local';
process.env.LLM_API_KEY = '';
process.env.ALLOW_PRIVATE_NETWORKS = 'true';
process.env.NODE_ENV = 'test';
