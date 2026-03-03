import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Writes the store root package manifest atomically.
 *
 * @param {string} packageJsonPath
 * @param {Record<string, unknown>} storePackage
 * @returns {Promise<void>}
 */
export async function writeStorePackage(packageJsonPath, storePackage) {
  await mkdir(path.dirname(packageJsonPath), { recursive: true });
  const temporaryPath = `${packageJsonPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(storePackage, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, packageJsonPath);
}
