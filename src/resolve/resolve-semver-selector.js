import semver from 'semver';
import { createError } from '../errors.js';

/**
 * Resolves a semver selector against installed registry-backed records.
 *
 * @template {({ alias: string, resolvedType: string, resolvedVersion?: string })} T
 * @param {string} packageName
 * @param {string} selector
 * @param {T[]} records
 * @returns {T | null}
 */
export function resolveSemverSelector(packageName, selector, records) {
  const registryRecords = records.filter(
    (record) => record.resolvedType === 'registry' && Boolean(record.resolvedVersion)
  );

  if (!registryRecords.length) {
    throw createError(
      'ERR_VERSIONARY_UNSUPPORTED_SELECTOR',
      'Version selectors are only supported for registry-backed installs.',
      { packageName, selector }
    );
  }

  const sorted = [...registryRecords].sort((left, right) =>
    semver.rcompare(left.resolvedVersion, right.resolvedVersion)
  );

  if (selector === 'latest') {
    return sorted[0];
  }

  if (semver.valid(selector)) {
    return sorted.find((record) => record.resolvedVersion === selector) ?? null;
  }

  const range = semver.validRange(selector, { loose: true });
  if (!range) {
    throw createError('ERR_VERSIONARY_INVALID_SELECTOR', 'Unsupported version selector.', {
      packageName,
      selector,
    });
  }

  return sorted.find((record) => semver.satisfies(record.resolvedVersion, range)) ?? null;
}
