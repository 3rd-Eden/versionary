import { access, copyFile, rm, readFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createError } from './errors.js';
/** @typedef {import('./types.js').StorePackage} StorePackage */
import { resolveInstall } from './install/resolve-install.js';
import { parseInstallSpec } from './install/parse-spec.js';
import { reifyStore } from './install/reify-store.js';
import { rewriteInstalledManifest } from './install/rewrite-installed-manifest.js';
import { snapshotLocalSource } from './install/snapshot-local-source.js';
import { importPackage } from './load/import-package.js';
import { requirePackage } from './load/require-package.js';
import { cleanStore } from './maintenance/clean.js';
import { prunePackage } from './maintenance/prune.js';
import { uninstallAlias } from './maintenance/uninstall.js';
import { ensureStoreInitialized } from './store/ensure-store.js';
import { readStorePackage } from './store/read-store-package.js';
import { writeStorePackage } from './store/write-store-package.js';
import { resolveTarget } from './resolve/resolve-target.js';
import { buildNpmOptions } from './utils/npm-options.js';
import { hasExportCondition } from './utils/exports.js';
import { getAliasInstallPath, getDefaultStoreRoot } from './utils/paths.js';

/**
 * Infers the verify mode for an installed package from its manifest metadata.
 *
 * @param {{ installPath: string }} record
 * @returns {Promise<'import'|'require'|'both'>}
 */
async function readInstalledManifestMode(record) {
  const content = await readFile(`${record.installPath}/package.json`, 'utf8');
  const manifest = JSON.parse(content);
  const exportsField = manifest.exports;

  const hasImport = hasExportCondition(exportsField, 'import');
  const hasRequire = hasExportCondition(exportsField, 'require');

  if (manifest.type === 'module') {
    return hasRequire ? 'both' : 'import';
  }

  if (hasImport && hasRequire) {
    return 'both';
  }

  if (hasImport) {
    return 'import';
  }

  return 'require';
}

/**
 * @typedef {{
 *   debug?: (message: string, meta?: Record<string, unknown>) => void,
 *   info?: (message: string, meta?: Record<string, unknown>) => void,
 *   warn?: (message: string, meta?: Record<string, unknown>) => void,
 *   error?: (message: string, meta?: Record<string, unknown>) => void
 * }} VersionaryLogger
 */

/** @type {VersionaryLogger} */
const noopLogger = Object.freeze({});

/**
 * Restores the store manifest and local artifact state after a failed install.
 *
 * @param {{
 *   packageJsonPath: string,
 *   snapshot: string,
 *   storeRoot: string,
 *   npmOptions: Record<string, unknown>,
 *   installRecord: { artifactPath?: string },
 *   existingRecord?: { artifactPath?: string },
 *   artifactBackupPath?: string
 * }} options
 * @returns {Promise<void>}
 */
async function rollbackInstallState({
  packageJsonPath,
  snapshot,
  storeRoot,
  npmOptions,
  installRecord,
  existingRecord,
  artifactBackupPath,
}) {
  if (installRecord.artifactPath) {
    if (artifactBackupPath) {
      await copyFile(artifactBackupPath, installRecord.artifactPath);
    } else if (!existingRecord?.artifactPath) {
      await rm(installRecord.artifactPath, { force: true });
    }
  }

  await writeStorePackage(packageJsonPath, JSON.parse(snapshot));
  await reifyStore(storeRoot, npmOptions);
}

/**
 * Public API for managing packages in the Versionary store.
 */
export class Versionary {
  /** @type {boolean} */
  #initialized = false;

  /** @type {VersionaryLogger} */
  #logger;

  /**
   * @param {string} [storeRoot]
   * @param {{
   *   registry?: string,
   *   scopes?: Record<string, string>,
   *   npmConfig?: Record<string, string|number|boolean>,
   *   authTokens?: Record<string, string>,
   *   cacheDir?: string,
   *   tempDir?: string,
   *   logger?: VersionaryLogger
   * }} [options]
   */
  constructor(storeRoot, options = {}) {
    this.storeRoot = storeRoot ?? getDefaultStoreRoot();
    this.#logger = options.logger ?? noopLogger;
    this.options = { ...options };
  }

  /**
   * @param {'debug'|'info'|'warn'|'error'} level
   * @param {string} message
   * @param {Record<string, unknown>} [meta]
   */
  #log(level, message, meta) {
    const fn = this.#logger[level];
    if (typeof fn === 'function') {
      fn(message, meta);
    }
  }

  /**
   * Creates or normalizes the managed store and caches the computed paths.
   *
   * @returns {Promise<{ paths: ReturnType<typeof import('./utils/paths.js').getStorePaths>, storePackage?: StorePackage }>}
   */
  async #initialize() {
    if (this.#initialized) {
      return { paths: this.paths };
    }

    this.#log('debug', 'Initializing store', { storeRoot: this.storeRoot });

    const { paths, storePackage } = await ensureStoreInitialized({
      ...this.options,
      storeRoot: this.storeRoot,
    });

    this.paths = paths;
    this.npmOptions = await buildNpmOptions({
      ...this.options,
      storeRoot: this.storeRoot,
      cacheDir: this.options.cacheDir ?? paths.cacheRoot,
      tempDir: this.options.tempDir ?? paths.tmpRoot,
      warn: (message) => this.#log('warn', message),
    });

    this.#initialized = true;
    this.#log('debug', 'Store initialized', { storeRoot: this.storeRoot });
    return { paths, storePackage };
  }

  /**
   * Reads the current store manifest after initialization.
   *
   * @returns {Promise<StorePackage>}
   */
  async #readCurrentStorePackage() {
    const storePackage = await readStorePackage(this.paths.packageJsonPath);
    if (!storePackage) {
      throw createError('ERR_VERSIONARY_STORE_INIT_FAILED', 'Store package.json is missing after initialization.', {
        packageJsonPath: this.paths.packageJsonPath,
      });
    }

    return storePackage;
  }

  /**
   * Installs one package variant into the managed store.
   *
   * @param {string} name
   * @param {string | { force?: boolean, prune?: boolean, verify?: boolean | { mode?: 'auto'|'import'|'require'|'both', hook?: (loaded: unknown, record: Record<string, unknown>) => boolean|void|Promise<boolean|void> } }} [spec]
   * @param {{ force?: boolean, prune?: boolean, verify?: boolean | { mode?: 'auto'|'import'|'require'|'both', hook?: (loaded: unknown, record: Record<string, unknown>) => boolean|void|Promise<boolean|void> } }} [options]
   * @returns {Promise<Record<string, unknown> & { alias: string, installPath: string }>}
   */
  async install(name, spec, options = {}) {
    if (typeof name !== 'string' || !name) {
      throw createError('ERR_VERSIONARY_INVALID_TARGET', 'Package name must be a non-empty string.', { name });
    }

    const { paths } = await this.#initialize();
    const installOptions =
      spec && typeof spec === 'object' && !Array.isArray(spec) ? spec : options;
    const requestedSpecValue = typeof spec === 'string' ? spec : undefined;
    const parsed = parseInstallSpec(name, requestedSpecValue, this.storeRoot);
    const requestedSpec = requestedSpecValue ?? parsed.rawSpec;
    const installRecord = await resolveInstall({
      parsed,
      requestedSpec,
      packageName: parsed.name ?? name,
      npmOptions: this.npmOptions,
      paths,
      storeRoot: this.storeRoot,
      persistArtifacts: false,
    });

    const storePackage = await this.#readCurrentStorePackage();
    const existingRecord = storePackage.versionary.packages?.[installRecord.alias];
    let installPathExists = true;

    try {
      await access(installRecord.installPath, fsConstants.F_OK);
    } catch (error) {
      if (error.code === 'ENOENT') {
        installPathExists = false;
      } else {
        throw error;
      }
    }

    if (
      existingRecord &&
      !installOptions.force &&
      existingRecord.dependencySpec === installRecord.dependencySpec &&
      installPathExists
    ) {
      this.#log('debug', 'Package already installed, skipping', { alias: installRecord.alias });
      return {
        alias: installRecord.alias,
        ...existingRecord,
        installPath: installRecord.installPath,
      };
    }

    this.#log('info', 'Installing package', {
      packageName: installRecord.packageName,
      alias: installRecord.alias,
      resolvedType: installRecord.resolvedType,
      resolvedVersion: installRecord.resolvedVersion,
    });

    const snapshot = JSON.stringify(storePackage);
    let artifactBackupPath;

    try {
      if ((parsed.type === 'file' || parsed.type === 'directory') && installRecord.artifactPath) {
        if (existingRecord?.artifactPath === installRecord.artifactPath) {
          try {
            await access(installRecord.artifactPath, fsConstants.F_OK);
            artifactBackupPath = `${installRecord.artifactPath}.${process.pid}.${Date.now()}.bak`;
            await copyFile(installRecord.artifactPath, artifactBackupPath);
          } catch (error) {
            if (error.code !== 'ENOENT') {
              throw error;
            }
          }
        }

        await snapshotLocalSource({
          parsed,
          alias: installRecord.alias,
          artifactsRoot: paths.artifactsRoot,
          npmOptions: this.npmOptions,
          storeRoot: this.storeRoot,
        });
      }

      storePackage.dependencies[installRecord.alias] = installRecord.dependencySpec;
      storePackage.versionary.packages[installRecord.alias] = {
        packageName: installRecord.packageName,
        requestedSpec: installRecord.requestedSpec,
        dependencySpec: installRecord.dependencySpec,
        resolvedType: installRecord.resolvedType,
        resolvedVersion: installRecord.resolvedVersion,
        resolvedLocator: installRecord.resolvedLocator,
        integrity: installRecord.integrity,
        gitSha: installRecord.gitSha,
        installedAt: installRecord.installedAt,
        artifactPath: installRecord.artifactPath,
      };

      await writeStorePackage(paths.packageJsonPath, storePackage);
      await reifyStore(this.storeRoot, this.npmOptions);
      await rewriteInstalledManifest(installRecord);

      this.#log('info', 'Package installed', { alias: installRecord.alias, installPath: installRecord.installPath });

      const record = {
        alias: installRecord.alias,
        ...structuredClone(storePackage.versionary.packages[installRecord.alias]),
        installPath: installRecord.installPath,
      };

      if (installOptions.verify) {
        const verifyOptions = installOptions.verify === true ? {} : installOptions.verify;
        const result = await this.verify(record, verifyOptions);
        if (!result.ok) {
          throw createError(
            'ERR_VERSIONARY_VERIFY_FAILED',
            'Managed package verification failed after install.',
            { alias: record.alias },
            { cause: result.error }
          );
        }
      }

      if (installOptions.prune) {
        const currentStorePackage = await this.#readCurrentStorePackage();
        await prunePackage({
          storePackage: currentStorePackage,
          packageJsonPath: this.paths.packageJsonPath,
          packageName: installRecord.packageName,
          keepAliases: [record.alias],
          storeRoot: this.storeRoot,
          npmOptions: this.npmOptions,
        });
      }

      return record;
    } catch (error) {
      this.#log('error', 'Install failed, rolling back store state', { alias: installRecord.alias });

      try {
        await rollbackInstallState({
          packageJsonPath: paths.packageJsonPath,
          snapshot,
          storeRoot: this.storeRoot,
          npmOptions: this.npmOptions,
          installRecord,
          existingRecord,
          artifactBackupPath,
        });
      } catch (rollbackError) {
        this.#log('error', 'Rollback failed after install error', {
          alias: installRecord.alias,
          rollbackError,
        });
      } finally {
        if (artifactBackupPath) {
          await rm(artifactBackupPath, { force: true }).catch(() => {});
        }
      }

      if (error?.code === 'ERR_VERSIONARY_VERIFY_FAILED') {
        throw error;
      }

      throw createError(
        'ERR_VERSIONARY_INSTALL_FAILED',
        'Failed to install managed package.',
        { packageName: name, spec: requestedSpec, alias: installRecord.alias },
        { cause: error }
      );
    } finally {
      if (artifactBackupPath) {
        await rm(artifactBackupPath, { force: true }).catch(() => {});
      }
    }
  }

  /**
   * Imports a managed package through ESM semantics.
   *
   * @param {string|{ alias: string }|{ name: string, spec: string }} target
   * @returns {Promise<unknown>}
   */
  async import(target) {
    await this.#initialize();
    const storePackage = await this.#readCurrentStorePackage();
    const record = resolveTarget(this.storeRoot, storePackage, target);
    this.#log('debug', 'Importing package', { alias: record.alias });
    return importPackage(this.storeRoot, record.alias);
  }

  /**
   * Loads a managed package through CommonJS semantics.
   *
   * @param {string|{ alias: string }|{ name: string, spec: string }} target
   * @returns {Promise<unknown>}
   */
  async require(target) {
    await this.#initialize();
    const storePackage = await this.#readCurrentStorePackage();
    const record = resolveTarget(this.storeRoot, storePackage, target);
    this.#log('debug', 'Requiring package', { alias: record.alias });
    return requirePackage(this.storeRoot, record.alias);
  }

  /**
   * Verifies that a managed package can be loaded and optionally passes a hook.
   *
   * @param {string|{ alias: string }|{ name: string, spec: string }} target
   * @param {{ mode?: 'auto'|'import'|'require'|'both', hook?: (loaded: unknown, record: Record<string, unknown>) => boolean|void|Promise<boolean|void> }} [options]
   * @returns {Promise<{ ok: boolean, alias: string, mode: 'import'|'require'|'both', error?: unknown }>}
   */
  async verify(target, options = {}) {
    await this.#initialize();
    const storePackage = await this.#readCurrentStorePackage();
    const record = resolveTarget(this.storeRoot, storePackage, target);
    const mode = options.mode && options.mode !== 'auto' ? options.mode : await readInstalledManifestMode(record);

    this.#log('debug', 'Verifying package', { alias: record.alias, mode });

    try {
      let loaded;

      if (mode === 'import') {
        loaded = await this.import(record);
      } else if (mode === 'require') {
        loaded = await this.require(record);
      } else {
        loaded = {
          import: await this.import(record),
          require: await this.require(record),
        };
      }

      if (typeof options.hook === 'function') {
        const hookResult = await options.hook(loaded, record);
        if (hookResult === false) {
          throw createError('ERR_VERSIONARY_VERIFY_FAILED', 'Verification hook returned false.', {
            alias: record.alias,
          });
        }
      }

      this.#log('debug', 'Verification passed', { alias: record.alias, mode });
      return {
        ok: true,
        alias: record.alias,
        mode,
      };
    } catch (error) {
      this.#log('warn', 'Verification failed', { alias: record.alias, mode });
      return {
        ok: false,
        alias: record.alias,
        mode,
        error,
      };
    }
  }

  /**
   * Uninstalls one managed package variant.
   *
   * @param {string|{ alias: string }|{ name: string, spec: string }} target
   * @returns {Promise<{ removed: boolean, alias: string }>}
   */
  async uninstall(target) {
    await this.#initialize();
    const storePackage = await this.#readCurrentStorePackage();
    const record = resolveTarget(this.storeRoot, storePackage, target);
    this.#log('info', 'Uninstalling package', { alias: record.alias });
    return uninstallAlias({
      storePackage,
      packageJsonPath: this.paths.packageJsonPath,
      alias: record.alias,
      storeRoot: this.storeRoot,
      npmOptions: this.npmOptions,
    });
  }

  /**
   * Removes all managed variants for one original package name.
   *
   * @param {string} packageName
   * @returns {Promise<{ removedAliases: string[], packageName: string }>}
   */
  async prune(packageName) {
    if (typeof packageName !== 'string' || !packageName) {
      throw createError('ERR_VERSIONARY_INVALID_TARGET', 'Package name must be a non-empty string.', { packageName });
    }

    await this.#initialize();
    this.#log('info', 'Pruning package variants', { packageName });
    const storePackage = await this.#readCurrentStorePackage();
    return prunePackage({
      storePackage,
      packageJsonPath: this.paths.packageJsonPath,
      packageName,
      storeRoot: this.storeRoot,
      npmOptions: this.npmOptions,
    });
  }

  /**
   * Wipes the managed store back to an empty initialized state.
   *
   * @returns {Promise<{ removedAliases: string[], removedArtifacts: string[], resetStore: boolean }>}
   */
  async clean() {
    await this.#initialize();
    this.#log('info', 'Cleaning store', { storeRoot: this.storeRoot });
    const storePackage = await this.#readCurrentStorePackage();
    return cleanStore({
      paths: this.paths,
      storePackage,
    });
  }

  /**
   * Lists installed package records, optionally filtered by original package name.
   *
   * @param {string} [packageName]
   * @returns {Promise<Array<Record<string, unknown> & { alias: string, installPath: string }>>}
   */
  async list(packageName) {
    await this.#initialize();
    const storePackage = await this.#readCurrentStorePackage();
    const packages = storePackage.versionary.packages ?? {};

    const entries = Object.entries(packages).map(([alias, record]) => ({
      alias,
      ...record,
      installPath: getAliasInstallPath(this.storeRoot, alias),
    }));

    if (packageName) {
      return entries.filter((entry) => entry.packageName === packageName);
    }

    return entries;
  }
}
