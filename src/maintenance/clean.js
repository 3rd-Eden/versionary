import { mkdir, rm } from 'node:fs/promises';
/** @typedef {import('../types.js').StorePackage} StorePackage */
import { writeStorePackage } from '../store/write-store-package.js';

/**
 * Resets the managed store to an empty initialized state.
 *
 * @param {{
 *   paths: {
 *     nodeModulesPath: string,
 *     packageLockPath: string,
 *     artifactsRoot: string,
 *     tmpRoot: string,
 *     metadataRoot: string,
 *     cacheRoot: string,
 *     packageJsonPath: string
 *   },
 *   storePackage: StorePackage
 * }} options
 * @returns {Promise<{ removedAliases: string[], removedArtifacts: string[], resetStore: boolean }>}
 */
export async function cleanStore({ paths, storePackage }) {
  const removedAliases = Object.keys(storePackage.versionary.packages ?? {});
  const removedArtifacts = removedAliases
    .map((alias) => storePackage.versionary.packages?.[alias]?.artifactPath)
    .filter(Boolean);

  await rm(paths.nodeModulesPath, { recursive: true, force: true });
  await rm(paths.packageLockPath, { force: true });
  await rm(paths.artifactsRoot, { recursive: true, force: true });
  await rm(paths.tmpRoot, { recursive: true, force: true });
  await rm(paths.metadataRoot, { recursive: true, force: true });
  await rm(paths.cacheRoot, { recursive: true, force: true });

  storePackage.dependencies = {};
  storePackage.versionary.packages = {};

  await writeStorePackage(paths.packageJsonPath, storePackage);
  await mkdir(paths.artifactsRoot, { recursive: true });
  await mkdir(paths.tmpRoot, { recursive: true });
  await mkdir(paths.metadataRoot, { recursive: true });
  await mkdir(paths.cacheRoot, { recursive: true });

  return {
    removedAliases,
    removedArtifacts,
    resetStore: true,
  };
}
