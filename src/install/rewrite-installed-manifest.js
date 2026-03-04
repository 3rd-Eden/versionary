import { readFile, writeFile } from 'node:fs/promises';

/**
 * Rewrites an installed package manifest with Versionary metadata.
 *
 * @param {{
 *   installPath: string,
 *   alias: string,
 *   packageName: string,
 *   resolvedType: string,
 *   resolvedVersion?: string,
 *   gitSha?: string,
 *   requestedSpec: string,
 *   resolvedLocator: string,
 *   integrity?: string,
 *   installedAt: string
 * }} record
 * @returns {Promise<void>}
 */
export async function rewriteInstalledManifest(record) {
  const manifestPath = `${record.installPath}/package.json`;
  const content = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(content);

  manifest.name = record.alias;
  manifest.versionary = {
    originalName: record.packageName,
    requestedSpec: record.requestedSpec,
    resolvedLocator: record.resolvedLocator,
    resolvedType: record.resolvedType,
    integrity: record.integrity,
    gitSha: record.gitSha,
    installedAt: record.installedAt,
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
