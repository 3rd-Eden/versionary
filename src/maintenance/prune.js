import { rm } from 'node:fs/promises';
/** @typedef {import('../types.js').StorePackage} StorePackage */
import { reifyStore } from '../install/reify-store.js';
import { writeStorePackage } from '../store/write-store-package.js';

/**
 * Removes all managed variants for one original package name.
 *
 * @param {{
 *   storePackage: StorePackage,
 *   packageJsonPath: string,
 *   packageName: string,
 *   keepAliases?: string[],
 *   storeRoot: string,
 *   npmOptions: Record<string, unknown>
 * }} options
 * @returns {Promise<{ removedAliases: string[], packageName: string }>}
 */
export async function prunePackage({
  storePackage,
  packageJsonPath,
  packageName,
  keepAliases = [],
  storeRoot,
  npmOptions,
}) {
  const aliases = Object.entries(storePackage.versionary.packages ?? {})
    .filter(([, record]) => record.packageName === packageName)
    .filter(([alias]) => !keepAliases.includes(alias))
    .map(([alias]) => alias);

  for (const alias of aliases) {
    const record = storePackage.versionary.packages[alias];
    delete storePackage.dependencies[alias];
    delete storePackage.versionary.packages[alias];

    if (record.artifactPath) {
      await rm(record.artifactPath, { force: true });
    }
  }

  if (!aliases.length) {
    return {
      removedAliases: [],
      packageName,
    };
  }

  await writeStorePackage(packageJsonPath, storePackage);
  await reifyStore(storeRoot, npmOptions);

  return {
    removedAliases: aliases,
    packageName,
  };
}
