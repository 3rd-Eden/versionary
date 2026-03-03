import { createHash } from 'node:crypto';

/**
 * Creates a short deterministic SHA-256 hash fragment.
 *
 * @param {string} value
 * @param {number} [length=8]
 * @returns {string}
 */
export function shortHash(value, length = 8) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}
