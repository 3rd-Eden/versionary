import { createHash } from 'node:crypto';
import { readFile, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';

/**
 * Creates a short deterministic SHA-256 hash fragment.
 *
 * @param {string} value
 * @param {number} [length=8]
 * @returns {string}
 */
export function shortHash(value, length = 8) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

/**
 * Hashes a local file by content.
 *
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function hashFileContent(filePath) {
  const hash = createHash('sha256');
  hash.update(await readFile(filePath));
  return hash.digest('hex');
}

/**
 * Hashes a directory tree deterministically by relative path and file content.
 *
 * @param {string} rootDir
 * @returns {Promise<string>}
 */
export async function hashDirectoryContent(rootDir) {
  const hash = createHash('sha256');

  async function visit(currentDir) {
    const entries = await readdir(currentDir, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(rootDir, absolutePath);
      const prefix = `${entry.isDirectory() ? 'dir' : entry.isSymbolicLink() ? 'symlink' : 'file'}:${relativePath}\0`;
      hash.update(prefix);

      if (entry.isDirectory()) {
        await visit(absolutePath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        hash.update(await readlink(absolutePath));
        continue;
      }

      hash.update(await readFile(absolutePath));
    }
  }

  await visit(rootDir);
  return hash.digest('hex');
}
