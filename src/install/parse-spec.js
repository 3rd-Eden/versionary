import npa from 'npm-package-arg';

/**
 * Parses an install request using npm-package-arg.
 *
 * @param {string} name
 * @param {string|undefined} spec
 * @param {string} where
 * @returns {import('npm-package-arg').Result}
 */
export function parseInstallSpec(name, spec, where) {
  if (spec === undefined) {
    const parsed = npa(name, where);

    if (parsed.rawSpec === '*' && parsed.raw === parsed.name) {
      return npa.resolve(parsed.name, 'latest', where);
    }

    return parsed;
  }

  return npa.resolve(name, spec ?? 'latest', where);
}
