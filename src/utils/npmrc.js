import { dirname, resolve } from 'node:path';
import Config from '@npmcli/config';
import defs from '@npmcli/config/lib/definitions/index.js';

const { definitions, shorthands, flatten, nerfDarts } = defs;

/**
 * Resolve the path to the bundled npm installation relative to the running
 * Node.js binary so @npmcli/config can locate its built-in defaults.
 *
 * @returns {string} Absolute path to the npm package root
 */
function npmPath() {
  return resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'npm');
}

/**
 * Load the full npm config chain (project, user, global, and built-in .npmrc
 * files plus environment variables) and return the flattened options object
 * that pacote and Arborist expect.
 *
 * @returns {Promise<Record<string, unknown>>} Flattened npm config
 */
export async function readNpmrc() {
  const config = new Config({
    definitions,
    shorthands,
    flatten,
    nerfDarts,
    npmPath: npmPath(),
    argv: [process.execPath, 'versionary'],
    warn: false,
  });

  await config.load();
  return config.flat;
}
