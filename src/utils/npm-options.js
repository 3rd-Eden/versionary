import { URL } from 'node:url';
import { readNpmrc } from './npmrc.js';

/**
 * Converts a registry URL into the npm config key used for auth tokens.
 *
 * @param {string} registryUrl
 * @returns {string}
 */
function toRegistryKey(registryUrl) {
  const url = new URL(registryUrl);
  const pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `//${url.host}${pathname}:_authToken`;
}

/**
 * Builds the npm-compatible options object passed to pacote and Arborist.
 *
 * Loads the full npm config chain via @npmcli/config first so that auth
 * tokens and registry settings from .npmrc files are available by default,
 * then applies any explicit constructor options on top.
 *
 * @param {{
 *   storeRoot: string,
 *   registry?: string,
 *   scopes?: Record<string, string>,
 *   npmConfig?: Record<string, string|number|boolean>,
 *   authTokens?: Record<string, string>,
 *   cacheDir?: string,
 *   tempDir?: string
 * }} [config]
 * @returns {Promise<Record<string, string|number|boolean|undefined>>}
 */
export async function buildNpmOptions(config = {}) {
  const {
    storeRoot,
    registry,
    scopes = {},
    npmConfig = {},
    authTokens = {},
    cacheDir,
    tempDir,
  } = config;

  const rc = await readNpmrc();

  const options = {
    ...rc,
    ...npmConfig,
    cache: cacheDir,
    tmp: tempDir,
    where: storeRoot,
    path: storeRoot,
    fullMetadata: true,
  };

  if (registry) {
    options.registry = registry;
  }

  for (const [scope, scopedRegistry] of Object.entries(scopes)) {
    options[`${scope}:registry`] = scopedRegistry;
  }

  for (const [registryUrl, token] of Object.entries(authTokens)) {
    options[toRegistryKey(registryUrl)] = token;
  }

  return options;
}
