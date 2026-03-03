import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { buildNpmOptions } from '../../src/utils/npm-options.js';
import { readNpmrc } from '../../src/utils/npmrc.js';
import { ensureStoreInitialized } from '../../src/store/ensure-store.js';
import { readStorePackage } from '../../src/store/read-store-package.js';
import { writeStorePackage } from '../../src/store/write-store-package.js';

async function createTempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'versionary-unit-'));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

describe('store and utility modules', () => {
  it('builds npm options with registry, scopes, and auth tokens', async () => {
    const options = await buildNpmOptions({
      storeRoot: '/tmp/versionary-store',
      registry: 'https://registry.example.test/root',
      scopes: {
        '@foo': 'https://scope.example.test/custom'
      },
      npmConfig: {
        audit: false
      },
      authTokens: {
        'https://registry.example.test/root': 'root-token',
        'https://scope.example.test/custom/': 'scope-token'
      },
      cacheDir: '/tmp/versionary-cache',
      tempDir: '/tmp/versionary-tmp'
    });

    assert.equal(options.registry, 'https://registry.example.test/root');
    assert.equal(options['@foo:registry'], 'https://scope.example.test/custom');
    assert.equal(options['//registry.example.test/root/:_authToken'], 'root-token');
    assert.equal(options['//scope.example.test/custom/:_authToken'], 'scope-token');
    assert.equal(options.audit, false);
    assert.equal(options.cache, '/tmp/versionary-cache');
    assert.equal(options.tmp, '/tmp/versionary-tmp');
    assert.equal(options.path, '/tmp/versionary-store');
    assert.equal(options.where, '/tmp/versionary-store');
  });

  it('loads npm config chain via @npmcli/config', async () => {
    const rc = await readNpmrc();
    assert.equal(typeof rc, 'object');
    assert.equal(typeof rc.registry, 'string');
  });

  it('merges npmrc config into build options with explicit overrides winning', async () => {
    const options = await buildNpmOptions({
      storeRoot: '/tmp/versionary-store',
      registry: 'https://override.example.test/',
      cacheDir: '/tmp/cache',
      tempDir: '/tmp/tmp',
    });

    assert.equal(options.registry, 'https://override.example.test/');
    assert.equal(typeof options, 'object');
  });

  it('reads missing store manifests as null and writes manifests atomically', async () => {
    const tempDir = await createTempDir();
    const packageJsonPath = path.join(tempDir, 'package.json');

    try {
      assert.equal(await readStorePackage(packageJsonPath), null);

      await writeStorePackage(packageJsonPath, {
        private: true,
        dependencies: {},
        versionary: {
          managedScope: '@versionary',
          packages: {}
        }
      });

      assert.deepEqual(await readJson(packageJsonPath), {
        private: true,
        dependencies: {},
        versionary: {
          managedScope: '@versionary',
          packages: {}
        }
      });

      await writeFile(packageJsonPath, '{not-json', 'utf8');
      await assert.rejects(() => readStorePackage(packageJsonPath), SyntaxError);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('initializes a new store and normalizes an existing store manifest', async () => {
    const tempDir = await createTempDir();

    try {
      const created = await ensureStoreInitialized({
        storeRoot: tempDir,
        registry: 'https://registry.example.test/',
        scopes: {
          '@foo': 'https://scope.example.test/'
        }
      });

      assert.equal(created.storePackage.private, true);
      assert.equal(created.storePackage.type, 'module');
      assert.equal(created.storePackage.versionary.managedScope, '@versionary');
      assert.equal(created.storePackage.versionary.registry, 'https://registry.example.test/');
      assert.deepEqual(created.storePackage.versionary.scopes, {
        '@foo': 'https://scope.example.test/'
      });

      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'broken-store',
          private: false,
          dependencies: null,
          versionary: {
            storeVersion: 0,
            managedScope: '@versionary',
            registry: 'https://old-registry.example.test/',
            packages: null
          }
        }),
        'utf8'
      );

      const normalized = await ensureStoreInitialized({
        storeRoot: tempDir,
        registry: 'https://new-registry.example.test/',
        scopes: {}
      });

      assert.equal(normalized.storePackage.private, true);
      assert.equal(normalized.storePackage.type, 'module');
      assert.deepEqual(normalized.storePackage.dependencies, {});
      assert.equal(normalized.storePackage.versionary.storeVersion, 1);
      assert.equal(normalized.storePackage.versionary.registry, 'https://new-registry.example.test/');
      assert.deepEqual(normalized.storePackage.versionary.packages, {});

      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'repair-store',
          private: true,
          type: 'module',
          dependencies: {},
          versionary: {
            storeVersion: 1,
            registry: 'https://new-registry.example.test/',
            scopes: {
              '@old': 'https://old-scope.example/'
            },
            packages: {}
          }
        }),
        'utf8'
      );

      const repaired = await ensureStoreInitialized({
        storeRoot: tempDir,
        scopes: {
          '@new': 'https://new-scope.example/'
        }
      });

      assert.equal(repaired.storePackage.versionary.managedScope, '@versionary');
      assert.deepEqual(repaired.storePackage.versionary.scopes, {
        '@new': 'https://new-scope.example/'
      });
      assert.equal('scopedRegistries' in repaired.storePackage.versionary, false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('rejects stores that declare a different managed scope', async () => {
    const tempDir = await createTempDir();

    try {
      await mkdir(tempDir, { recursive: true });
      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          private: true,
          type: 'module',
          dependencies: {},
          versionary: {
            managedScope: '@other',
            packages: {}
          }
        }),
        'utf8'
      );

      await assert.rejects(
        () => ensureStoreInitialized({ storeRoot: tempDir }),
        (error) => error?.code === 'ERR_VERSIONARY_STORE_INIT_FAILED'
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

});
