import { copyFile } from 'node:fs/promises';
import path from 'node:path';
import Arborist from '@npmcli/arborist';
import pacote from 'pacote';
import { aliasToArtifactFilename } from '../utils/package-name-segment.js';

/**
 * Snapshots local file and directory installs into store-managed artifacts.
 *
 * @param {{
 *   parsed: import('npm-package-arg').Result,
 *   alias: string,
 *   artifactsRoot: string,
 *   npmOptions: Record<string, unknown>,
 *   storeRoot: string
 * }} options
 * @returns {Promise<{ artifactPath: string, dependencySpec: string }>}
 */
export async function snapshotLocalSource({ parsed, alias, artifactsRoot, npmOptions, storeRoot }) {
  const artifactPath = path.join(artifactsRoot, `${aliasToArtifactFilename(alias)}.tgz`);

  if (parsed.type === 'file') {
    await copyFile(parsed.fetchSpec, artifactPath);
    return {
      artifactPath,
      dependencySpec: `file:${path.relative(storeRoot, artifactPath)}`,
    };
  }

  await pacote.tarball.file(`file:${parsed.fetchSpec}`, artifactPath, {
    ...npmOptions,
    where: storeRoot,
    Arborist,
  });

  return {
    artifactPath,
    dependencySpec: `file:${path.relative(storeRoot, artifactPath)}`,
  };
}
