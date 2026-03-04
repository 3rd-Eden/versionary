import { createError } from '../errors.js';
/** @typedef {import('../types.js').StorePackage} StorePackage */
/** @typedef {import('../types.js').PackageRecord} PackageRecord */
import { getAliasInstallPath } from '../utils/paths.js';
import { parseStringTarget } from './parse-string-target.js';
import { resolveSemverSelector } from './resolve-semver-selector.js';

/**
 * Resolves a caller target into one concrete installed record.
 *
 * @param {string} storeRoot
 * @param {StorePackage} storePackage
 * @param {string|{ alias: string }|{ name: string, spec: string }} target
 * @returns {PackageRecord & { alias: string, installPath: string }}
 */
export function resolveTarget(storeRoot, storePackage, target) {
  /** @type {Array<PackageRecord & { alias: string }>} */
  const records = Object.entries(storePackage.versionary.packages ?? {}).map(([alias, record]) => ({
    alias,
    ...record,
  }));

  if (typeof target === 'string') {
    const parsed = parseStringTarget(target);
    if (!parsed) {
      throw createError('ERR_VERSIONARY_INVALID_TARGET', 'Unsupported target string.', { target });
    }

    if (parsed.type === 'alias') {
      const record = storePackage.versionary.packages?.[parsed.alias];
      if (!record) {
        throw createError('ERR_VERSIONARY_NOT_INSTALLED', 'Managed alias is not installed.', {
          alias: parsed.alias,
        });
      }

      return {
        alias: parsed.alias,
        ...record,
        installPath: getAliasInstallPath(storeRoot, parsed.alias),
      };
    }

    const packageRecords = records.filter((record) => record.packageName === parsed.name);
    if (!packageRecords.length) {
      throw createError('ERR_VERSIONARY_NOT_INSTALLED', 'Package is not installed.', {
        packageName: parsed.name,
        selector: parsed.selector,
      });
    }

    const resolved = resolveSemverSelector(parsed.name, parsed.selector, packageRecords);
    if (!resolved) {
      throw createError('ERR_VERSIONARY_NOT_INSTALLED', 'No installed version satisfies the selector.', {
        packageName: parsed.name,
        selector: parsed.selector,
        });
      }

    return {
      ...resolved,
      installPath: getAliasInstallPath(storeRoot, resolved.alias),
    };
  }

  if (target && typeof target === 'object' && 'alias' in target) {
    const record = storePackage.versionary.packages?.[target.alias];
    if (!record) {
      throw createError('ERR_VERSIONARY_NOT_INSTALLED', 'Managed alias is not installed.', {
        alias: target.alias,
      });
    }

    return {
      alias: target.alias,
      ...record,
      installPath: getAliasInstallPath(storeRoot, target.alias),
    };
  }

  if (target && typeof target === 'object' && 'name' in target && 'spec' in target) {
    const matches = records.filter(
      (record) => record.packageName === target.name && record.requestedSpec === target.spec
    );

    if (!matches.length) {
      throw createError('ERR_VERSIONARY_NOT_INSTALLED', 'Package spec is not installed.', {
        packageName: target.name,
        spec: target.spec,
      });
    }

    if (matches.length > 1) {
      throw createError('ERR_VERSIONARY_INVALID_TARGET', 'Package spec target is ambiguous.', {
        packageName: target.name,
        spec: target.spec,
        aliases: matches.map((record) => record.alias),
      });
    }

    return {
      ...matches[0],
      installPath: getAliasInstallPath(storeRoot, matches[0].alias),
    };
  }

  throw createError('ERR_VERSIONARY_INVALID_TARGET', 'Unsupported target.', { target });
}
