import { snapshotLocalSource } from './snapshot-local-source.js';

/**
 * Normalizes a resolved install into the pinned dependency spec stored in the
 * managed store root package.json.
 *
 * @param {{
 *   parsed: import('npm-package-arg').Result,
 *   packageName?: string,
 *   resolvedVersion?: string,
 *   resolvedLocator: string,
 *   alias?: string,
 *   artifactsRoot?: string,
 *   npmOptions?: Record<string, unknown>,
 *   storeRoot?: string
 * }} context
 * @returns {Promise<{ dependencySpec: string, artifactPath?: string }>}
 */
export async function normalizeDependencySpec(context) {
  const { parsed, packageName, resolvedVersion, resolvedLocator } = context;

  if (parsed.registry) {
    return {
      dependencySpec: `npm:${packageName}@${resolvedVersion}`,
    };
  }

  if (parsed.type === 'git' || parsed.type === 'remote') {
    return {
      dependencySpec: resolvedLocator,
    };
  }

  if (parsed.type === 'file' || parsed.type === 'directory') {
    return snapshotLocalSource(/** @type {any} */ (context));
  }

  return {
    dependencySpec: resolvedLocator,
  };
}
