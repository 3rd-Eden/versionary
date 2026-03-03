import os from 'node:os';
import path from 'node:path';

/**
 * Returns the default managed store root.
 *
 * @returns {string}
 */
export function getDefaultStoreRoot() {
  return path.join(os.homedir(), '.versionary');
}

/**
 * Builds the internal path map for a managed store.
 *
 * @param {string} storeRoot
 * @returns {{
 *   storeRoot: string,
 *   packageJsonPath: string,
 *   packageLockPath: string,
 *   nodeModulesPath: string,
 *   internalRoot: string,
 *   locksRoot: string,
 *   tmpRoot: string,
 *   artifactsRoot: string,
 *   metadataRoot: string,
 *   cacheRoot: string
 * }}
 */
export function getStorePaths(storeRoot) {
  const internalRoot = path.join(storeRoot, '.versionary');
  return {
    storeRoot,
    packageJsonPath: path.join(storeRoot, 'package.json'),
    packageLockPath: path.join(storeRoot, 'package-lock.json'),
    nodeModulesPath: path.join(storeRoot, 'node_modules'),
    internalRoot,
    locksRoot: path.join(internalRoot, 'locks'),
    tmpRoot: path.join(internalRoot, 'tmp'),
    artifactsRoot: path.join(internalRoot, 'artifacts'),
    metadataRoot: path.join(internalRoot, 'metadata'),
    cacheRoot: path.join(internalRoot, 'cache'),
  };
}

/**
 * Resolves the installed package directory for a managed alias.
 *
 * @param {string} storeRoot
 * @param {string} alias
 * @returns {string}
 */
export function getAliasInstallPath(storeRoot, alias) {
  return path.join(storeRoot, 'node_modules', ...alias.split('/'));
}
