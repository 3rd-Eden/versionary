import { pathToFileURL } from 'node:url';
import { resolveImportEntry } from './resolve-package-entry.js';

/**
 * Loads a managed package through ESM semantics.
 *
 * @param {string} storeRoot
 * @param {string} alias
 * @returns {Promise<unknown>}
 */
export async function importPackage(storeRoot, alias) {
  const resolvedPath = await resolveImportEntry(storeRoot, alias);
  return import(pathToFileURL(resolvedPath).href);
}
