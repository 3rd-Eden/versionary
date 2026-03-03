import { mkdir } from 'node:fs/promises';
import { createError } from '../errors.js';
import { getStorePaths } from '../utils/paths.js';
import { readStorePackage } from './read-store-package.js';
import { writeStorePackage } from './write-store-package.js';

/**
 * Creates the base store manifest used for new stores.
 *
 * @param {{ registry?: string, scopes?: Record<string, string> }} config
 * @returns {Record<string, unknown>}
 */
function createBaseStorePackage(config) {
  return {
    name: 'versionary-store',
    private: true,
    type: 'module',
    dependencies: {},
    versionary: {
      storeVersion: 1,
      managedScope: '@versionary',
      registry: config.registry ?? 'https://registry.npmjs.org/',
      scopes: { ...(config.scopes ?? {}) },
      packages: {},
    },
  };
}

/**
 * Creates or normalizes the managed store on disk.
 *
 * @param {{ storeRoot: string, registry?: string, scopes?: Record<string, string> }} config
 * @returns {Promise<{ paths: ReturnType<typeof getStorePaths>, storePackage: Record<string, unknown> }>}
 */
export async function ensureStoreInitialized(config) {
  const paths = getStorePaths(config.storeRoot);

  await mkdir(paths.storeRoot, { recursive: true });
  await mkdir(paths.tmpRoot, { recursive: true });
  await mkdir(paths.artifactsRoot, { recursive: true });
  await mkdir(paths.metadataRoot, { recursive: true });
  await mkdir(paths.cacheRoot, { recursive: true });

  let storePackage = await readStorePackage(paths.packageJsonPath);
  let changed = false;

  if (!storePackage) {
    storePackage = createBaseStorePackage(config);
    changed = true;
  }

  if (storePackage.private !== true) {
    storePackage.private = true;
    changed = true;
  }

  if (storePackage.type !== 'module') {
    storePackage.type = 'module';
    changed = true;
  }

  if (!storePackage.dependencies || typeof storePackage.dependencies !== 'object') {
    storePackage.dependencies = {};
    changed = true;
  }

  if (!storePackage.versionary || typeof storePackage.versionary !== 'object') {
    storePackage.versionary = createBaseStorePackage(config).versionary;
    changed = true;
  }

  if (storePackage.versionary.managedScope && storePackage.versionary.managedScope !== '@versionary') {
    throw createError(
      'ERR_VERSIONARY_STORE_INIT_FAILED',
      'Existing store is managed by an unsupported scope.',
      { managedScope: storePackage.versionary.managedScope }
    );
  }

  if (storePackage.versionary.storeVersion !== 1) {
    storePackage.versionary.storeVersion = 1;
    changed = true;
  }

  if (storePackage.versionary.managedScope !== '@versionary') {
    storePackage.versionary.managedScope = '@versionary';
    changed = true;
  }

  if (!storePackage.versionary.packages || typeof storePackage.versionary.packages !== 'object') {
    storePackage.versionary.packages = {};
    changed = true;
  }

  const registry = config.registry ?? storePackage.versionary.registry ?? 'https://registry.npmjs.org/';
  if (storePackage.versionary.registry !== registry) {
    storePackage.versionary.registry = registry;
    changed = true;
  }

  const scopes = {
    ...(config.scopes ?? storePackage.versionary.scopes ?? storePackage.versionary.scopedRegistries ?? {}),
  };
  if (JSON.stringify(storePackage.versionary.scopes ?? {}) !== JSON.stringify(scopes)) {
    storePackage.versionary.scopes = scopes;
    changed = true;
  }

  if ('scopedRegistries' in storePackage.versionary) {
    delete storePackage.versionary.scopedRegistries;
    changed = true;
  }

  if (changed) {
    await writeStorePackage(paths.packageJsonPath, storePackage);
  }

  return { paths, storePackage };
}
