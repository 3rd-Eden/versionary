import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createError } from '../errors.js';
import { hasExportCondition } from '../utils/exports.js';
import { getAliasInstallPath } from '../utils/paths.js';

/**
 * Selects the best export target for a set of preferred conditions.
 *
 * @param {unknown} value
 * @param {string[]} conditions
 * @returns {string|null}
 */
function pickConditionalExport(value, conditions) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const resolved = pickConditionalExport(item, conditions);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  }

  if (typeof value === 'object') {
    for (const condition of conditions) {
      if (condition in value) {
        const resolved = pickConditionalExport(value[condition], conditions);
        if (resolved) {
          return resolved;
        }
      }
    }

    for (const [key, nested] of Object.entries(value)) {
      if (key.startsWith('.')) {
        continue;
      }

      const resolved = pickConditionalExport(nested, conditions);
      if (resolved) {
        return resolved;
      }
    }
  }

  return null;
}

/**
 * @typedef {{
 *   name?: string,
 *   type?: string,
 *   main?: string,
 *   module?: string,
 *   exports?: any
 * } & Record<string, unknown>} InstalledManifest
 */

/**
 * Reads the installed package manifest for a managed alias.
 *
 * @param {string} storeRoot
 * @param {string} alias
 * @returns {Promise<{ installPath: string, manifest: InstalledManifest }>}
 */
async function readInstalledManifest(storeRoot, alias) {
  const installPath = getAliasInstallPath(storeRoot, alias);
  const manifestPath = path.join(installPath, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

  return {
    installPath,
    manifest,
  };
}

/**
 * Resolves the ESM entry path for a managed alias.
 *
 * @param {string} storeRoot
 * @param {string} alias
 * @returns {Promise<string>}
 */
export async function resolveImportEntry(storeRoot, alias) {
  const { installPath, manifest } = await readInstalledManifest(storeRoot, alias);
  const exportTarget = typeof manifest.exports === 'object' && '.' in manifest.exports
    ? manifest.exports['.']
    : manifest.exports;

  const target =
    pickConditionalExport(exportTarget, ['import', 'default', 'node']) ??
    manifest.module ??
    manifest.main ??
    './index.js';

  return path.resolve(installPath, target);
}

/**
 * Resolves the CommonJS entry path and require function for a managed alias.
 *
 * @param {string} storeRoot
 * @param {string} alias
 * @returns {Promise<{ require: NodeJS.Require, resolvedPath: string }>}
 */
export async function resolveRequireEntry(storeRoot, alias) {
  const { installPath, manifest } = await readInstalledManifest(storeRoot, alias);
  const exportTarget = typeof manifest.exports === 'object' && '.' in manifest.exports
    ? manifest.exports['.']
    : manifest.exports;
  const supportsRequire =
    hasExportCondition(exportTarget, 'require') ||
    (typeof manifest.main === 'string' && manifest.main.endsWith('.cjs')) ||
    (!manifest.type || manifest.type === 'commonjs');

  if (!supportsRequire) {
    throw createError(
      'ERR_VERSIONARY_REQUIRE_UNSUPPORTED',
      'The managed package does not expose a CommonJS entrypoint.',
      { alias }
    );
  }

  const target =
    pickConditionalExport(exportTarget, ['require', 'default', 'node']) ??
    manifest.main ??
    './index.js';

  return {
    require: createRequire(path.join(storeRoot, 'package.json')),
    resolvedPath: path.resolve(installPath, target),
  };
}
