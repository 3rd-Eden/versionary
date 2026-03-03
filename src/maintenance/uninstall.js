import { rm } from 'node:fs/promises';
import { reifyStore } from '../install/reify-store.js';
import { writeStorePackage } from '../store/write-store-package.js';

/**
 * Removes a single managed alias from the store.
 *
 * @param {{
 *   storePackage: Record<string, unknown>,
 *   packageJsonPath: string,
 *   alias: string,
 *   npmOptions: Record<string, unknown>
 * }} options
 * @returns {Promise<{ removed: boolean, alias: string }>}
 */
export async function uninstallAlias({ storePackage, packageJsonPath, alias, npmOptions }) {
  const record = storePackage.versionary.packages?.[alias];
  if (!record) {
    return { removed: false, alias };
  }

  delete storePackage.dependencies[alias];
  delete storePackage.versionary.packages[alias];

  if (record.artifactPath) {
    await rm(record.artifactPath, { force: true });
  }

  await writeStorePackage(packageJsonPath, storePackage);
  await reifyStore(npmOptions.path, npmOptions);

  return { removed: true, alias };
}
