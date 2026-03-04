import { rm } from 'node:fs/promises';
/** @typedef {import('../types.js').StorePackage} StorePackage */
import { reifyStore } from '../install/reify-store.js';
import { writeStorePackage } from '../store/write-store-package.js';

/**
 * Removes a single managed alias from the store.
 *
 * @param {{
 *   storePackage: StorePackage,
 *   packageJsonPath: string,
 *   alias: string,
 *   storeRoot: string,
 *   npmOptions: Record<string, unknown>
 * }} options
 * @returns {Promise<{ removed: boolean, alias: string }>}
 */
export async function uninstallAlias({ storePackage, packageJsonPath, alias, storeRoot, npmOptions }) {
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
  await reifyStore(storeRoot, npmOptions);

  return { removed: true, alias };
}
