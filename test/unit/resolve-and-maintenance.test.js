import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { cleanStore } from '../../src/maintenance/clean.js';
import { prunePackage } from '../../src/maintenance/prune.js';
import { parseStringTarget } from '../../src/resolve/parse-string-target.js';
import { resolveSemverSelector } from '../../src/resolve/resolve-semver-selector.js';
import { resolveTarget } from '../../src/resolve/resolve-target.js';
import { uninstallAlias } from '../../src/maintenance/uninstall.js';

function createStorePackage() {
  return {
    dependencies: {
      '@versionary/abbrev--1.1.1': 'npm:abbrev@1.1.1',
      '@versionary/abbrev--3.0.1': 'npm:abbrev@3.0.1',
      '@versionary/example__pkg--deadbeef': 'git+https://example.test/repo.git#deadbeef'
    },
    versionary: {
      managedScope: '@versionary',
      packages: {
        '@versionary/abbrev--1.1.1': {
          packageName: 'abbrev',
          requestedSpec: '1.1.1',
          resolvedType: 'registry',
          resolvedVersion: '1.1.1',
          resolvedLocator: 'npm:abbrev@1.1.1'
        },
        '@versionary/abbrev--3.0.1': {
          packageName: 'abbrev',
          requestedSpec: '3.0.1',
          resolvedType: 'registry',
          resolvedVersion: '3.0.1',
          resolvedLocator: 'npm:abbrev@3.0.1'
        },
        '@versionary/example__pkg--deadbeef': {
          packageName: '@example/pkg',
          requestedSpec: 'git+https://example.test/repo.git',
          resolvedType: 'git',
          resolvedLocator: 'git+https://example.test/repo.git#deadbeef',
          gitSha: 'deadbeef'
        }
      }
    }
  };
}

async function createTempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'versionary-unit-'));
}

describe('resolve and maintenance modules', () => {
  it('returns null for unsupported string targets', () => {
    assert.equal(parseStringTarget('abbrev'), null);
    assert.equal(parseStringTarget(''), null);
  });

  it('handles selector resolution success and failure paths', () => {
    const registryRecords = [
      { alias: 'a', resolvedType: 'registry', resolvedVersion: '1.0.0' },
      { alias: 'b', resolvedType: 'registry', resolvedVersion: '2.0.0' }
    ];

    assert.equal(resolveSemverSelector('abbrev', 'latest', registryRecords)?.alias, 'b');
    assert.equal(resolveSemverSelector('abbrev', '^1', registryRecords)?.alias, 'a');
    assert.equal(resolveSemverSelector('abbrev', '3', registryRecords), null);

    assert.throws(
      () => resolveSemverSelector('@example/pkg', 'latest', [
        { alias: 'git', resolvedType: 'git', resolvedLocator: 'git+https://example.test/repo.git#sha' }
      ]),
      (error) => error?.code === 'ERR_VERSIONARY_UNSUPPORTED_SELECTOR'
    );

    assert.throws(
      () => resolveSemverSelector('abbrev', 'not-a-range', registryRecords),
      (error) => error?.code === 'ERR_VERSIONARY_INVALID_SELECTOR'
    );
  });

  it('resolves alias, selector, and spec targets', () => {
    const storePackage = createStorePackage();
    const storeRoot = '/tmp/versionary-store';

    assert.equal(
      resolveTarget(storeRoot, storePackage, '@versionary/abbrev--3.0.1').alias,
      '@versionary/abbrev--3.0.1'
    );
    assert.equal(resolveTarget(storeRoot, storePackage, 'abbrev@latest').alias, '@versionary/abbrev--3.0.1');
    assert.equal(resolveTarget(storeRoot, storePackage, 'abbrev@1').alias, '@versionary/abbrev--1.1.1');
    assert.equal(
      resolveTarget(storeRoot, storePackage, { alias: '@versionary/abbrev--1.1.1' }).alias,
      '@versionary/abbrev--1.1.1'
    );
    assert.equal(
      resolveTarget(storeRoot, storePackage, { name: '@example/pkg', spec: 'git+https://example.test/repo.git' }).alias,
      '@versionary/example__pkg--deadbeef'
    );
    assert.throws(
      () => resolveTarget(storeRoot, storePackage, '@versionary/missing--1.0.0'),
      (error) => error?.code === 'ERR_VERSIONARY_NOT_INSTALLED'
    );

    assert.throws(
      () => resolveTarget(storeRoot, storePackage, 'missing@1'),
      (error) => error?.code === 'ERR_VERSIONARY_NOT_INSTALLED'
    );

    assert.throws(
      () => resolveTarget(storeRoot, storePackage, 'abbrev@9'),
      (error) => error?.code === 'ERR_VERSIONARY_NOT_INSTALLED'
    );

    assert.throws(
      () => resolveTarget(storeRoot, storePackage, { alias: '@versionary/missing--1.0.0' }),
      (error) => error?.code === 'ERR_VERSIONARY_NOT_INSTALLED'
    );

    assert.throws(
      () => resolveTarget(storeRoot, storePackage, { name: 'missing', spec: '1.0.0' }),
      (error) => error?.code === 'ERR_VERSIONARY_NOT_INSTALLED'
    );

    const ambiguousStore = createStorePackage();
    ambiguousStore.versionary.packages['@versionary/abbrev--1.1.2'] = {
      packageName: 'abbrev',
      requestedSpec: '1.1.1',
      resolvedType: 'registry',
      resolvedVersion: '1.1.2',
      resolvedLocator: 'npm:abbrev@1.1.2'
    };

    assert.throws(
      () => resolveTarget(storeRoot, ambiguousStore, { name: 'abbrev', spec: '1.1.1' }),
      (error) => error?.code === 'ERR_VERSIONARY_INVALID_TARGET'
    );

    assert.throws(
      () => resolveTarget(storeRoot, storePackage, 123),
      (error) => error?.code === 'ERR_VERSIONARY_INVALID_TARGET'
    );
  });

  it('uninstalls, prunes, and cleans store package state', async () => {
    const tempDir = await createTempDir();
    const packageJsonPath = path.join(tempDir, 'package.json');
    const artifactPath = path.join(tempDir, 'artifact.tgz');
    const packageLockPath = path.join(tempDir, 'package-lock.json');
    const nodeModulesPath = path.join(tempDir, 'node_modules');
    const artifactsRoot = path.join(tempDir, '.versionary', 'artifacts');
    const tmpRoot = path.join(tempDir, '.versionary', 'tmp');
    const metadataRoot = path.join(tempDir, '.versionary', 'metadata');
    const cacheRoot = path.join(tempDir, '.versionary', 'cache');

    try {
      const uninstallStore = {
        dependencies: {
          '@versionary/example__pkg--deadbeef': 'file:.versionary/artifacts/example__pkg.tgz'
        },
        versionary: {
          managedScope: '@versionary',
          packages: {
            '@versionary/example__pkg--deadbeef': {
              packageName: '@example/pkg',
              requestedSpec: 'file:artifact.tgz',
              resolvedType: 'local-tarball',
              resolvedLocator: 'file:artifact.tgz',
              artifactPath
            }
          }
        }
      };

      await mkdir(tempDir, { recursive: true });
      await writeFile(packageJsonPath, JSON.stringify(uninstallStore, null, 2), 'utf8');
      await writeFile(artifactPath, 'artifact', 'utf8');

      assert.deepEqual(
        await uninstallAlias({
          storePackage: uninstallStore,
          packageJsonPath,
          alias: '@versionary/missing--1.0.0',
          storeRoot: tempDir,
          npmOptions: { path: tempDir }
        }),
        { removed: false, alias: '@versionary/missing--1.0.0' }
      );

      const removed = await uninstallAlias({
        storePackage: uninstallStore,
        packageJsonPath,
        alias: '@versionary/example__pkg--deadbeef',
        storeRoot: tempDir,
        npmOptions: { path: tempDir }
      });
      assert.deepEqual(removed, { removed: true, alias: '@versionary/example__pkg--deadbeef' });

      const prunableStore = {
        dependencies: {
          '@versionary/abbrev--1.1.1': 'npm:abbrev@1.1.1',
          '@versionary/abbrev--3.0.1': 'npm:abbrev@3.0.1'
        },
        versionary: {
          managedScope: '@versionary',
          packages: {
            '@versionary/abbrev--1.1.1': createStorePackage().versionary.packages['@versionary/abbrev--1.1.1'],
            '@versionary/abbrev--3.0.1': createStorePackage().versionary.packages['@versionary/abbrev--3.0.1']
          }
        }
      };

      await writeFile(packageJsonPath, JSON.stringify(prunableStore, null, 2), 'utf8');
      const pruned = await prunePackage({
        storePackage: prunableStore,
        packageJsonPath,
        packageName: 'abbrev',
        keepAliases: ['@versionary/abbrev--3.0.1'],
        storeRoot: tempDir,
        npmOptions: { path: tempDir }
      });
      assert.deepEqual(pruned.removedAliases, ['@versionary/abbrev--1.1.1']);
      const prunedStore = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      assert.deepEqual(Object.keys(prunedStore.dependencies), ['@versionary/abbrev--3.0.1']);

      const cleanableStore = {
        dependencies: {
          '@versionary/abbrev--1.1.1': 'npm:abbrev@1.1.1'
        },
        versionary: {
          managedScope: '@versionary',
          packages: {
            '@versionary/abbrev--1.1.1': createStorePackage().versionary.packages['@versionary/abbrev--1.1.1']
          }
        }
      };

      await mkdir(nodeModulesPath, { recursive: true });
      await mkdir(artifactsRoot, { recursive: true });
      await mkdir(tmpRoot, { recursive: true });
      await mkdir(metadataRoot, { recursive: true });
      await mkdir(cacheRoot, { recursive: true });
      await writeFile(packageLockPath, '{}', 'utf8');

      const cleanResult = await cleanStore({
        paths: {
          nodeModulesPath,
          packageLockPath,
          artifactsRoot,
          tmpRoot,
          metadataRoot,
          cacheRoot,
          packageJsonPath
        },
        storePackage: cleanableStore
      });

      assert.deepEqual(cleanResult.removedAliases, ['@versionary/abbrev--1.1.1']);
      assert.equal(cleanResult.resetStore, true);

      const rewritten = JSON.parse(await readFile(packageJsonPath, 'utf8'));
      assert.deepEqual(rewritten.dependencies, {});
      assert.deepEqual(rewritten.versionary.packages, {});
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
