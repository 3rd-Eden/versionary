import { createError } from '../errors.js';
import { resolveRequireEntry } from './resolve-package-entry.js';

/**
 * Loads a managed package through CommonJS semantics.
 *
 * @param {string} storeRoot
 * @param {string} alias
 * @returns {Promise<unknown>}
 */
export async function requirePackage(storeRoot, alias) {
  try {
    const { require, resolvedPath } = await resolveRequireEntry(storeRoot, alias);
    return require(resolvedPath);
  } catch (error) {
    if (error.code === 'ERR_REQUIRE_ASYNC_MODULE' || error.code === 'ERR_REQUIRE_ESM') {
      throw createError(
        'ERR_VERSIONARY_REQUIRE_UNSUPPORTED',
        'The managed package cannot be loaded through CommonJS require.',
        { alias },
        { cause: error }
      );
    }

    throw error;
  }
}
