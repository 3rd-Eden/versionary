/**
 * Converts a package name into the flattened segment used in managed aliases.
 *
 * @param {string} packageName
 * @returns {string}
 */
export function packageNameToSegment(packageName) {
  return packageName
    .replace(/^@/, '')
    .replace(/\//g, '__')
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Converts an alias into a filesystem-safe artifact file stem.
 *
 * @param {string} alias
 * @returns {string}
 */
export function aliasToArtifactFilename(alias) {
  return alias.replace(/^@/, '').replace(/\//g, '__');
}
