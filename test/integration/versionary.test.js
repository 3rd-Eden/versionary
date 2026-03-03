import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { Versionary } from '../../src/versionary.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, '..', 'fixtures');

async function createStoreRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'versionary-'));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function withVersionary(testFn) {
  const storeRoot = await createStoreRoot();
  const versionary = new Versionary(storeRoot);

  try {
    await testFn({ storeRoot, versionary });
  } finally {
    await rm(storeRoot, { recursive: true, force: true });
  }
}

describe('Versionary integration', () => {
  it('creates the store lazily and keeps clean() idempotent', async () => {
    await withVersionary(async ({ storeRoot, versionary }) => {
      const first = await versionary.clean();
      const storePackage = await readJson(path.join(storeRoot, 'package.json'));

      assert.equal(storePackage.private, true);
      assert.equal(storePackage.type, 'module');
      assert.deepEqual(storePackage.dependencies, {});
      assert.equal(storePackage.versionary.managedScope, '@versionary');
      assert.deepEqual(first.removedAliases, []);

      const second = await versionary.clean();
      assert.deepEqual(second.removedAliases, []);
    });
  });

  it('installs local ESM fixtures and loads them through import()', async () => {
    await withVersionary(async ({ storeRoot, versionary }) => {
      const fixturePath = path.join(fixturesRoot, 'esm-fixture');
      const record = await versionary.install('@example/esm-fixture', `file:${fixturePath}`);
      const loaded = await versionary.import(record);
      const verifyResult = await versionary.verify(record, { mode: 'import' });
      const storePackage = await readJson(path.join(storeRoot, 'package.json'));

      assert.equal(record.alias.startsWith('@versionary/example__esm-fixture--'), true);
      assert.equal(loaded.default.kind, 'esm');
      assert.equal(verifyResult.ok, true);
      assert.equal(storePackage.dependencies[record.alias].startsWith('file:.versionary/artifacts/'), true);

      await assert.rejects(
        () => versionary.require(record),
        (error) => error?.code === 'ERR_VERSIONARY_REQUIRE_UNSUPPORTED'
      );
    });
  });

  it('installs local CommonJS fixtures and loads them through require()', async () => {
    await withVersionary(async ({ versionary }) => {
      const fixturePath = path.join(fixturesRoot, 'cjs-fixture');
      const record = await versionary.install('@example/cjs-fixture', `file:${fixturePath}`);
      const loaded = await versionary.require(record);

      assert.equal(record.alias.startsWith('@versionary/example__cjs-fixture--'), true);
      assert.deepEqual(loaded, {
        kind: 'cjs',
        answer: 42,
      });
    });
  });

  it('resolves registry installs by exact version, latest, and major selectors', async () => {
    await withVersionary(async ({ versionary }) => {
      await versionary.install('abbrev@1.1.1');
      await versionary.install('abbrev@3.0.1');

      const exact = await versionary.require('abbrev@1.1.1');
      assert.equal(typeof exact, 'function');

      const removedLatest = await versionary.uninstall('abbrev@latest');
      assert.equal(removedLatest.alias, '@versionary/abbrev--3.0.1');

      const removedMajor = await versionary.uninstall('abbrev@1');
      assert.equal(removedMajor.alias, '@versionary/abbrev--1.1.1');
    });
  });

  it('prunes one package family and clean() wipes the remaining store state', async () => {
    await withVersionary(async ({ storeRoot, versionary }) => {
      const cjsFixturePath = path.join(fixturesRoot, 'cjs-fixture');
      const cjsRecord = await versionary.install('@example/cjs-fixture', `file:${cjsFixturePath}`);
      await versionary.install('abbrev', '3.0.1');
      await versionary.install('abbrev', '1.1.1');

      const pruneResult = await versionary.prune('abbrev');
      const storeAfterPrune = await readJson(path.join(storeRoot, 'package.json'));

      assert.deepEqual(pruneResult.removedAliases.sort(), [
        '@versionary/abbrev--1.1.1',
        '@versionary/abbrev--3.0.1',
      ]);
      assert.deepEqual(Object.keys(storeAfterPrune.dependencies), [cjsRecord.alias]);

      const cleanResult = await versionary.clean();
      const storeAfterClean = await readJson(path.join(storeRoot, 'package.json'));

      assert.deepEqual(cleanResult.removedAliases, [cjsRecord.alias]);
      assert.deepEqual(storeAfterClean.dependencies, {});
      assert.deepEqual(storeAfterClean.versionary.packages, {});
    });
  });

  it('supports dual-mode verify hooks and rejects selector strings for non-registry installs', async () => {
    await withVersionary(async ({ versionary }) => {
      const fixturePath = path.join(fixturesRoot, 'dual-fixture');
      const record = await versionary.install('@example/dual-fixture', `file:${fixturePath}`);
      const verifyResult = await versionary.verify(record, {
        mode: 'both',
        hook: async (loaded, context) => {
          assert.equal(context.alias, record.alias);
          assert.equal(loaded.import.default.kind, 'dual-import');
          assert.equal(loaded.require.kind, 'dual-require');
        }
      });

      assert.equal(verifyResult.ok, true);

      const failedVerify = await versionary.verify(record, {
        mode: 'both',
        hook: async () => false
      });
      assert.equal(failedVerify.ok, false);

      await assert.rejects(
        () => versionary.import('@example/dual-fixture@latest'),
        (error) => error?.code === 'ERR_VERSIONARY_UNSUPPORTED_SELECTOR'
      );
    });
  });

  it('reuses existing installs, supports auto verify modes, and surfaces verify failures during install', async () => {
    await withVersionary(async ({ versionary }) => {
      const cjsFixturePath = path.join(fixturesRoot, 'cjs-fixture');
      const esmFixturePath = path.join(fixturesRoot, 'esm-fixture');
      const dualFixturePath = path.join(fixturesRoot, 'dual-fixture');

      const first = await versionary.install('@example/cjs-fixture', `file:${cjsFixturePath}`, { verify: true });
      const second = await versionary.install('@example/cjs-fixture', `file:${cjsFixturePath}`);
      assert.equal(first.alias, second.alias);

      const cjsVerify = await versionary.verify(first);
      assert.equal(cjsVerify.ok, true);
      assert.equal(cjsVerify.mode, 'require');

      const esmRecord = await versionary.install('@example/esm-fixture', `file:${esmFixturePath}`);
      const esmVerify = await versionary.verify(esmRecord);
      assert.equal(esmVerify.ok, true);
      assert.equal(esmVerify.mode, 'import');

      const dualRecord = await versionary.install('@example/dual-fixture', `file:${dualFixturePath}`);
      const dualVerify = await versionary.verify(dualRecord);
      assert.equal(dualVerify.ok, true);
      assert.equal(dualVerify.mode, 'both');

      await assert.rejects(
        () =>
          versionary.install('@example/esm-fixture', `file:${esmFixturePath}`, {
            force: true,
            verify: {
              mode: 'import',
              hook: async () => false
            }
          }),
        (error) => error?.code === 'ERR_VERSIONARY_VERIFY_FAILED'
      );

      await assert.rejects(
        () => versionary.import('not-a-valid-target'),
        (error) => error?.code === 'ERR_VERSIONARY_INVALID_TARGET'
      );
    });
  });

  it('can prune older installed variants after a selector-based install', async () => {
    await withVersionary(async ({ storeRoot, versionary }) => {
      await versionary.install('abbrev@1.1.1');
      const latestRecord = await versionary.install('abbrev@latest', { prune: true });
      const storePackage = await readJson(path.join(storeRoot, 'package.json'));
      const loaded = await versionary.require('abbrev@latest');

      assert.equal(latestRecord.alias.startsWith('@versionary/abbrev--'), true);
      assert.notEqual(latestRecord.alias, '@versionary/abbrev--1.1.1');
      assert.deepEqual(Object.keys(storePackage.dependencies), [latestRecord.alias]);
      assert.equal(typeof loaded, 'function');

      await assert.rejects(
        () => versionary.require('abbrev@1'),
        (error) => error?.code === 'ERR_VERSIONARY_NOT_INSTALLED'
      );
    });
  });

  it('installs from a mirror registry when configured', { timeout: 30_000 }, async () => {
    const storeRoot = await createStoreRoot();
    const versionary = new Versionary(storeRoot, {
      registry: 'https://registry.yarnpkg.com/'
    });

    try {
      const record = await versionary.install('abbrev', '3.0.1');
      const loaded = await versionary.require('abbrev@latest');
      const storePackage = await readJson(path.join(storeRoot, 'package.json'));

      assert.equal(record.alias, '@versionary/abbrev--3.0.1');
      assert.equal(typeof loaded, 'function');
      assert.equal(storePackage.versionary.registry, 'https://registry.yarnpkg.com/');
      assert.equal(storePackage.dependencies['@versionary/abbrev--3.0.1'], 'npm:abbrev@3.0.1');
    } finally {
      await rm(storeRoot, { recursive: true, force: true });
    }
  });

  it('keeps installed package module formats independent from the store root type', { timeout: 30_000 }, async () => {
    await withVersionary(async ({ storeRoot, versionary }) => {
      const cjsRecord = await versionary.install('abbrev', '3.0.1');
      const esmRecord = await versionary.install('chalk', '5.3.0');

      const storePackage = await readJson(path.join(storeRoot, 'package.json'));
      const installedCjsManifest = await readJson(path.join(cjsRecord.installPath, 'package.json'));
      const installedEsmManifest = await readJson(path.join(esmRecord.installPath, 'package.json'));
      const cjsLoaded = await versionary.require('abbrev@3.0.1');
      const esmLoaded = await versionary.import('chalk@5.3.0');

      assert.equal(storePackage.type, 'module');

      assert.equal(installedCjsManifest.type, undefined);
      assert.equal(typeof cjsLoaded, 'function');

      assert.equal(installedEsmManifest.type, 'module');
      assert.equal(typeof esmLoaded.default, 'function');

      await assert.rejects(
        () => versionary.require('chalk@5.3.0'),
        (error) => error?.code === 'ERR_VERSIONARY_REQUIRE_UNSUPPORTED'
      );
    });
  });
});
