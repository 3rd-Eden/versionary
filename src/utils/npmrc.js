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
  const prefix = resolve(dirname(process.execPath), '..');
  if (process.platform === 'win32') {
    return resolve(prefix, 'node_modules', 'npm');
  }
  return resolve(prefix, 'lib', 'node_modules', 'npm');
}

/**
 * Load the full npm config chain (project, user, global, and built-in .npmrc
 * files plus environment variables) and return the flattened options object
 * that pacote and Arborist expect.
 *
 * @param {{ warn?: (message: string) => void }} [options]
 * @returns {Promise<Record<string, unknown>>} Flattened npm config
 */
export async function readNpmrc(options = {}) {
  const config = new Config({
    definitions,
    shorthands,
    flatten,
    nerfDarts,
    npmPath: npmPath(),
    argv: [process.execPath, 'versionary'],
    warn: options.warn ?? (() => {}),
  });

  await config.load();
  return config.flat;
}
