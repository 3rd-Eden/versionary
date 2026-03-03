import { URL } from 'node:url';

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
 * @param {{
 *   storeRoot: string,
 *   registry?: string,
 *   scopes?: Record<string, string>,
 *   npmConfig?: Record<string, string|number|boolean>,
 *   authTokens?: Record<string, string>,
 *   cacheDir?: string,
 *   tempDir?: string
 * }} [config]
 * @returns {Record<string, string|number|boolean|undefined>}
 */
export function buildNpmOptions(config = {}) {
  const {
    storeRoot,
    registry,
    scopes = {},
    npmConfig = {},
    authTokens = {},
    cacheDir,
    tempDir,
  } = config;

  const options = {
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
