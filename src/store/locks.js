import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { createError } from '../errors.js';
import { shortHash } from '../utils/hash.js';

/**
 * Waits for a short interval while polling for a lock.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns the lock directory path for a logical key.
 *
 * @param {string} locksRoot
 * @param {string} key
 * @returns {string}
 */
export function getLockPath(locksRoot, key) {
  return path.join(locksRoot, `${shortHash(key, 16)}.lock`);
}

/**
 * Runs a callback while holding an exclusive filesystem lock.
 *
 * @template T
 * @param {string} lockPath
 * @param {() => Promise<T>} fn
 * @param {{ timeoutMs?: number, pollMs?: number }} [options]
 * @returns {Promise<T>}
 */
export async function withLock(lockPath, fn, options = {}) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 100;
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw createError('ERR_VERSIONARY_LOCK_TIMEOUT', 'Timed out waiting for store lock.', {
          lockPath,
          timeoutMs,
        });
      }

      await sleep(pollMs);
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}
