import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it } from 'node:test';
import { normalizeDependencySpec } from '../../src/install/normalize-dependency-spec.js';
import { resolveInstall } from '../../src/install/resolve-install.js';
import { rewriteInstalledManifest } from '../../src/install/rewrite-installed-manifest.js';
import { requirePackage } from '../../src/load/require-package.js';
import { resolveImportEntry, resolveRequireEntry } from '../../src/load/resolve-package-entry.js';
import { getAliasInstallPath } from '../../src/utils/paths.js';

async function createTempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'versionary-unit-'));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

describe('install and load modules', () => {
  it('normalizes registry, git, remote, file, and directory dependency specs', async () => {
    const tempDir = await createTempDir();
    const artifactsRoot = path.join(tempDir, 'artifacts');
    const fixtureDir = path.join(tempDir, 'pkg');
    const tarballPath = path.join(tempDir, 'pkg.tgz');

    try {
      await mkdir(artifactsRoot, { recursive: true });
      await mkdir(fixtureDir, { recursive: true });
      await writeFile(path.join(fixtureDir, 'package.json'), JSON.stringify({
        name: 'fixture-dir',
        version: '1.0.0'
      }), 'utf8');
      await writeFile(path.join(fixtureDir, 'index.js'), 'module.exports = 42;\n', 'utf8');
      await writeFile(tarballPath, 'pretend-tarball', 'utf8');

      assert.deepEqual(
        await normalizeDependencySpec({
          parsed: { registry: true },
          packageName: 'abbrev',
          resolvedVersion: '1.1.1'
        }),
        { dependencySpec: 'npm:abbrev@1.1.1' }
      );

      assert.deepEqual(
        await normalizeDependencySpec({
          parsed: { registry: false, type: 'git' },
          resolvedLocator: 'git+https://example.test/repo.git#deadbeef'
        }),
        { dependencySpec: 'git+https://example.test/repo.git#deadbeef' }
      );

      assert.deepEqual(
        await normalizeDependencySpec({
          parsed: { registry: false, type: 'remote' },
          resolvedLocator: 'https://example.test/archive.tgz'
        }),
        { dependencySpec: 'https://example.test/archive.tgz' }
      );

      const fileSnapshot = await normalizeDependencySpec({
        parsed: { type: 'file', fetchSpec: tarballPath },
        alias: '@versionary/filepkg--deadbeef',
        artifactsRoot,
        npmOptions: {},
        storeRoot: tempDir
      });
      assert.equal(fileSnapshot.dependencySpec.startsWith('file:'), true);

      const dirSnapshot = await normalizeDependencySpec({
        parsed: { type: 'directory', fetchSpec: fixtureDir },
        alias: '@versionary/dirpkg--deadbeef',
        artifactsRoot,
        npmOptions: {},
        storeRoot: tempDir
      });
      assert.equal(dirSnapshot.dependencySpec.startsWith('file:'), true);

      assert.deepEqual(
        await normalizeDependencySpec({
          parsed: { type: 'alias' },
          resolvedLocator: 'npm:abbrev@1.1.1'
        }),
        { dependencySpec: 'npm:abbrev@1.1.1' }
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('resolves install metadata for registry and local directory installs', async () => {
    const tempDir = await createTempDir();
    const paths = {
      artifactsRoot: path.join(tempDir, 'artifacts')
    };
    const fixtureDir = path.join(tempDir, 'pkg');

    try {
      await mkdir(paths.artifactsRoot, { recursive: true });
      await mkdir(fixtureDir, { recursive: true });
      await writeFile(path.join(fixtureDir, 'package.json'), JSON.stringify({
        name: '@example/local-fixture',
        version: '1.2.3',
        type: 'module',
        exports: './index.js'
      }), 'utf8');
      await writeFile(path.join(fixtureDir, 'index.js'), 'export default 42;\n', 'utf8');

      const registryRecord = await resolveInstall({
        parsed: { raw: 'abbrev@1.1.1', registry: true, type: 'version' },
        requestedSpec: '1.1.1',
        packageName: 'abbrev',
        npmOptions: {},
        paths,
        storeRoot: tempDir
      });

      assert.equal(registryRecord.alias, '@versionary/abbrev--1.1.1');
      assert.equal(registryRecord.dependencySpec, 'npm:abbrev@1.1.1');
      assert.equal(registryRecord.resolvedType, 'registry');

      const directoryRecord = await resolveInstall({
        parsed: {
          raw: `file:${fixtureDir}`,
          registry: false,
          type: 'directory',
          fetchSpec: fixtureDir
        },
        requestedSpec: `file:${fixtureDir}`,
        packageName: '@example/local-fixture',
        npmOptions: {},
        paths,
        storeRoot: tempDir
      });

      assert.equal(directoryRecord.alias.startsWith('@versionary/example__local-fixture--'), true);
      assert.equal(directoryRecord.resolvedType, 'directory');
      assert.equal(directoryRecord.dependencySpec.startsWith('file:'), true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rewrites installed manifests and resolves import/require entries', async () => {
    const tempDir = await createTempDir();
    const importAlias = '@versionary/dual-fixture--1.0.0';
    const requireAlias = '@versionary/cjs-fixture--1.0.0';
    const importInstallPath = getAliasInstallPath(tempDir, importAlias);
    const requireInstallPath = getAliasInstallPath(tempDir, requireAlias);

    try {
      await mkdir(importInstallPath, { recursive: true });
      await mkdir(requireInstallPath, { recursive: true });

      await writeFile(path.join(importInstallPath, 'package.json'), JSON.stringify({
        name: '@example/dual-fixture',
        version: '1.0.0',
        type: 'module',
        exports: {
          '.': {
            import: './index.js',
            require: './index.cjs'
          }
        }
      }), 'utf8');
      await writeFile(path.join(importInstallPath, 'index.js'), 'export default "esm";\n', 'utf8');
      await writeFile(path.join(importInstallPath, 'index.cjs'), 'module.exports = "cjs";\n', 'utf8');

      await writeFile(path.join(requireInstallPath, 'package.json'), JSON.stringify({
        name: '@example/cjs-fixture',
        version: '1.0.0',
        main: './index.cjs'
      }), 'utf8');
      await writeFile(path.join(requireInstallPath, 'index.cjs'), 'module.exports = { ok: true };\n', 'utf8');
      await writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');

      await rewriteInstalledManifest({
        alias: importAlias,
        packageName: '@example/dual-fixture',
        requestedSpec: '1.0.0',
        resolvedType: 'registry',
        resolvedVersion: '1.0.0',
        resolvedLocator: 'npm:@example/dual-fixture@1.0.0',
        integrity: 'sha512-test',
        installPath: importInstallPath,
        installedAt: '2026-03-03T00:00:00.000Z'
      });

      const rewritten = await readJson(path.join(importInstallPath, 'package.json'));
      assert.equal(rewritten.name, importAlias);
      assert.equal(rewritten.version, '1.0.0');
      assert.equal(rewritten.versionary.originalName, '@example/dual-fixture');

      const importEntry = await resolveImportEntry(tempDir, importAlias);
      const requireEntry = await resolveRequireEntry(tempDir, importAlias);
      const required = await requirePackage(tempDir, requireAlias);

      assert.equal(importEntry, path.join(importInstallPath, 'index.js'));
      assert.equal(requireEntry.resolvedPath, path.join(importInstallPath, 'index.cjs'));
      assert.deepEqual(required, { ok: true });

      await mkdir(getAliasInstallPath(tempDir, '@versionary/import-only--1.0.0'), { recursive: true });
      await writeFile(
        path.join(getAliasInstallPath(tempDir, '@versionary/import-only--1.0.0'), 'package.json'),
        JSON.stringify({
          name: '@versionary/import-only--1.0.0',
          type: 'module',
          exports: './index.js'
        }),
        'utf8'
      );
      await writeFile(
        path.join(getAliasInstallPath(tempDir, '@versionary/import-only--1.0.0'), 'index.js'),
        'export default 1;\n',
        'utf8'
      );

      await assert.rejects(
        () => requirePackage(tempDir, '@versionary/import-only--1.0.0'),
        (error) => error?.code === 'ERR_VERSIONARY_REQUIRE_UNSUPPORTED'
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
