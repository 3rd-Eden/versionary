import { readFile } from 'node:fs/promises';
/** @typedef {import('../types.js').StorePackage} StorePackage */

/**
 * Reads the store root package manifest.
 *
 * @param {string} packageJsonPath
 * @returns {Promise<StorePackage|null>}
 */
export async function readStorePackage(packageJsonPath) {
  try {
    const content = await readFile(packageJsonPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}
