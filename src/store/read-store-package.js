import { readFile } from 'node:fs/promises';

/**
 * Reads the store root package manifest.
 *
 * @param {string} packageJsonPath
 * @returns {Promise<Record<string, unknown>|null>}
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
