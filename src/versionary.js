import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createError } from './errors.js';
import { resolveInstall } from './install/resolve-install.js';
import { parseInstallSpec } from './install/parse-spec.js';
import { reifyStore } from './install/reify-store.js';
import { rewriteInstalledManifest } from './install/rewrite-installed-manifest.js';
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
import { getDefaultStoreRoot } from './utils/paths.js';

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

  if (manifest.type === 'module') {
    if (hasRequireCondition(exportsField)) {
      return 'both';
    }

    return 'import';
  }

  if (hasImportCondition(exportsField) && hasRequireCondition(exportsField)) {
    return 'both';
  }

  if (hasImportCondition(exportsField) && !hasRequireCondition(exportsField)) {
    return 'import';
  }

  if (hasRequireCondition(exportsField)) {
    return 'require';
  }

  return 'require';
}

/**
 * Checks whether a package exports structure contains an `import` condition.
 *
 * @param {unknown} exportsField
 * @returns {boolean}
 */
function hasImportCondition(exportsField) {
  if (!exportsField || typeof exportsField === 'string') {
    return false;
  }

  if (Array.isArray(exportsField)) {
    return exportsField.some(hasImportCondition);
  }

  if ('import' in exportsField) {
    return true;
  }

  return Object.values(exportsField).some(hasImportCondition);
}

/**
 * Checks whether a package exports structure contains a `require` condition.
 *
 * @param {unknown} exportsField
 * @returns {boolean}
 */
function hasRequireCondition(exportsField) {
  if (!exportsField || typeof exportsField === 'string') {
    return false;
  }

  if (Array.isArray(exportsField)) {
    return exportsField.some(hasRequireCondition);
  }

  if ('require' in exportsField) {
    return true;
  }

  return Object.values(exportsField).some(hasRequireCondition);
}

/**
 * Public API for managing packages in the Versionary store.
 */
export class Versionary {
  /**
   * @param {string} [storeRoot]
   * @param {{
   *   registry?: string,
   *   scopes?: Record<string, string>,
   *   npmConfig?: Record<string, string|number|boolean>,
   *   authTokens?: Record<string, string>,
   *   cacheDir?: string,
   *   tempDir?: string,
   *   logger?: {
   *     debug?: (message: string, meta?: unknown) => void,
   *     info?: (message: string, meta?: unknown) => void,
   *     warn?: (message: string, meta?: unknown) => void,
   *     error?: (message: string, meta?: unknown) => void
   *   }
   * }} [options]
   */
  constructor(storeRoot, options = {}) {
    this.storeRoot = storeRoot ?? getDefaultStoreRoot();
    this.options = { ...options };
  }

  /**
   * Creates or normalizes the managed store and caches the computed paths.
   *
   * @returns {Promise<{ paths: ReturnType<typeof import('./utils/paths.js').getStorePaths>, storePackage: Record<string, unknown> }>}
   */
  async #initialize() {
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
    });

    return { paths, storePackage };
  }

  /**
   * Reads the current store manifest after initialization.
   *
   * @returns {Promise<Record<string, unknown>>}
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
      !options.force &&
      existingRecord.dependencySpec === installRecord.dependencySpec &&
      installPathExists
    ) {
      return {
        alias: installRecord.alias,
        ...existingRecord,
        installPath: installRecord.installPath,
      };
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

    try {
      await reifyStore(this.storeRoot, this.npmOptions);
      await rewriteInstalledManifest(installRecord);
    } catch (error) {
      throw createError(
        'ERR_VERSIONARY_INSTALL_FAILED',
        'Failed to install managed package.',
        { packageName: name, spec: requestedSpec, alias: installRecord.alias },
        { cause: error }
      );
    }

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
        npmOptions: this.npmOptions,
      });
    }

    return record;
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

      return {
        ok: true,
        alias: record.alias,
        mode,
      };
    } catch (error) {
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
    const currentStorePackage = await this.#readCurrentStorePackage();
    return uninstallAlias({
      storePackage: currentStorePackage,
      packageJsonPath: this.paths.packageJsonPath,
      alias: record.alias,
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
    await this.#initialize();
    const storePackage = await this.#readCurrentStorePackage();
    return prunePackage({
      storePackage,
      packageJsonPath: this.paths.packageJsonPath,
      packageName,
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
    const storePackage = await this.#readCurrentStorePackage();
    return cleanStore({
      paths: this.paths,
      storePackage,
    });
  }
}
