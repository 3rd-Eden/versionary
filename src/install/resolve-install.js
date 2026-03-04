import pacote from 'pacote';
import semver from 'semver';
import { hashDirectoryContent, hashFileContent, shortHash } from '../utils/hash.js';
import { packageNameToSegment } from '../utils/package-name-segment.js';
import { getAliasInstallPath } from '../utils/paths.js';
import { normalizeDependencySpec } from './normalize-dependency-spec.js';

/**
 * Maps npm-package-arg result types to Versionary's persisted resolution types.
 *
 * @param {import('npm-package-arg').Result} parsed
 * @returns {string}
 */
function mapResolvedType(parsed) {
  if (parsed.registry) {
    return 'registry';
  }

  if (parsed.type === 'git') {
    return 'git';
  }

  if (parsed.type === 'remote') {
    return 'remote-tarball';
  }

  if (parsed.type === 'file') {
    return 'local-tarball';
  }

  if (parsed.type === 'directory') {
    return 'directory';
  }

  return parsed.type;
}

/**
 * Builds the managed alias for an installed package.
 *
 * @param {string} packageName
 * @param {string} resolvedType
 * @param {string|undefined} resolvedVersion
 * @param {string} resolvedLocator
 * @param {string|undefined} localContentHash
 * @returns {string}
 */
function createAlias(packageName, resolvedType, resolvedVersion, resolvedLocator, localContentHash) {
  const segment = packageNameToSegment(packageName);

  if (resolvedType === 'registry' && resolvedVersion) {
    return `@versionary/${segment}--${resolvedVersion}`;
  }

  if ((resolvedType === 'local-tarball' || resolvedType === 'directory') && localContentHash) {
    return `@versionary/${segment}--${shortHash(localContentHash)}`;
  }

  return `@versionary/${segment}--${shortHash(resolvedLocator)}`;
}

/**
 * Extracts a git SHA suffix from a resolved locator when present.
 *
 * @param {string} resolvedLocator
 * @returns {string|undefined}
 */
function extractGitSha(resolvedLocator) {
  const match = /#(.+)$/.exec(resolvedLocator);
  return match?.[1];
}

/**
 * Resolves an install request into the persisted metadata used by the store.
 *
 * @param {{
 *   parsed: import('npm-package-arg').Result,
 *   requestedSpec: string,
 *   packageName: string,
 *   npmOptions: Record<string, unknown>,
 *   paths: { artifactsRoot: string },
 *   storeRoot: string,
 *   persistArtifacts?: boolean
 * }} context
 * @returns {Promise<{
 *   alias: string,
 *   packageName: string,
 *   requestedSpec: string,
 *   dependencySpec: string,
 *   resolvedType: string,
 *   resolvedVersion?: string,
 *   resolvedLocator: string,
 *   integrity?: string,
 *   gitSha?: string,
 *   installedAt: string,
 *   artifactPath?: string,
 *   installPath: string
 * }>}
 */
export async function resolveInstall(context) {
  const { parsed, packageName, npmOptions, paths, storeRoot } = context;
  const manifest = await pacote.manifest(parsed.raw, npmOptions);
  const resolvedLocator = manifest._resolved ?? (await pacote.resolve(parsed.raw, npmOptions));
  const resolvedType = mapResolvedType(parsed);
  const resolvedVersion = semver.valid(manifest.version) ? manifest.version : undefined;
  const localContentHash =
    parsed.type === 'file'
      ? await hashFileContent(parsed.fetchSpec)
      : parsed.type === 'directory'
        ? await hashDirectoryContent(parsed.fetchSpec)
        : undefined;
  const alias = createAlias(packageName, resolvedType, resolvedVersion, resolvedLocator, localContentHash);
  const { dependencySpec, artifactPath } = await normalizeDependencySpec({
    ...context,
    alias,
    artifactsRoot: paths.artifactsRoot,
    packageName,
      resolvedVersion,
      resolvedLocator,
      npmOptions,
      persistArtifacts: context.persistArtifacts,
    });

  return {
    alias,
    packageName,
    requestedSpec: context.requestedSpec,
    dependencySpec,
    resolvedType,
    resolvedVersion,
    resolvedLocator,
    integrity: manifest._integrity,
    gitSha: extractGitSha(resolvedLocator),
    installedAt: new Date().toISOString(),
    artifactPath,
    installPath: getAliasInstallPath(storeRoot, alias),
  };
}
