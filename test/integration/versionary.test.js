import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
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

async function createLocalFixture(rootDir, answer = 42) {
  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, 'package.json'), JSON.stringify({
    name: '@example/temp-cjs-fixture',
    version: '1.0.0',
    main: './index.cjs'
  }), 'utf8');
  await writeFile(
    path.join(rootDir, 'index.cjs'),
    `module.exports = {\n  kind: 'cjs',\n  answer: ${answer},\n};\n`,
    'utf8'
  );
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

      const esmInstalled = await versionary.list('@example/esm-fixture');
      assert.equal(esmInstalled.length, 1);
      assert.equal(esmInstalled[0].alias, esmRecord.alias);

      await assert.rejects(
        () => versionary.import('not-a-valid-target'),
        (error) => error?.code === 'ERR_VERSIONARY_INVALID_TARGET'
      );
    });
  });

  it('honors second-argument force installs and restores the previous install on verify failure', async () => {
    await withVersionary(async ({ versionary }) => {
      const fixtureRoot = await createStoreRoot();
      const spec = `@example/temp-cjs-fixture@file:${fixtureRoot}`;

      try {
        await createLocalFixture(fixtureRoot, 42);

        const first = await versionary.install(spec);
        const firstLoaded = await versionary.require(first);
        assert.equal(firstLoaded.answer, 42);

        await assert.rejects(
          () =>
            versionary.install(spec, {
              force: true,
              verify: {
                mode: 'require',
                hook: async () => false
              }
            }),
          (error) => error?.code === 'ERR_VERSIONARY_VERIFY_FAILED'
        );

        const afterFailedForce = await versionary.list('@example/temp-cjs-fixture');
        assert.equal(afterFailedForce.length, 1);
        assert.equal(afterFailedForce[0].installedAt, first.installedAt);
        assert.match(
          await readFile(path.join(first.installPath, 'index.cjs'), 'utf8'),
          /answer: 42/
        );

        await new Promise((resolve) => setTimeout(resolve, 20));
        await writeFile(
          path.join(fixtureRoot, 'index.cjs'),
          "module.exports = {\n  kind: 'cjs',\n  answer: 99,\n};\n",
          'utf8'
        );

        const forced = await versionary.install(spec, { force: true });
        assert.notEqual(forced.installedAt, first.installedAt);
        assert.notEqual(forced.alias, first.alias);
        assert.match(
          await readFile(path.join(forced.installPath, 'index.cjs'), 'utf8'),
          /answer: 99/
        );
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  });

  it('removes a newly added local install when verification fails', async () => {
    await withVersionary(async ({ storeRoot, versionary }) => {
      const fixtureRoot = await createStoreRoot();
      const spec = `@example/temp-cjs-fixture@file:${fixtureRoot}`;

      try {
        await createLocalFixture(fixtureRoot, 42);

        await assert.rejects(
          () =>
            versionary.install(spec, {
              verify: {
                mode: 'require',
                hook: async () => false
              }
            }),
          (error) => error?.code === 'ERR_VERSIONARY_VERIFY_FAILED'
        );

        assert.deepEqual(await versionary.list('@example/temp-cjs-fixture'), []);
        assert.deepEqual((await readJson(path.join(storeRoot, 'package.json'))).dependencies, {});
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  });

  it('does not rewrite local artifacts when reusing an existing install', async () => {
    await withVersionary(async ({ versionary }) => {
      const fixtureRoot = await createStoreRoot();
      const spec = `@example/temp-cjs-fixture@file:${fixtureRoot}`;

      try {
        await createLocalFixture(fixtureRoot, 42);

        const first = await versionary.install(spec);
        const beforeArtifact = await stat(first.artifactPath);

        await new Promise((resolve) => setTimeout(resolve, 20));

        const second = await versionary.install(spec);
        const afterArtifact = await stat(first.artifactPath);

        assert.equal(second.installedAt, first.installedAt);
        assert.equal(afterArtifact.mtimeMs, beforeArtifact.mtimeMs);
        assert.equal((await versionary.require(first)).answer, 42);
      } finally {
        await rm(fixtureRoot, { recursive: true, force: true });
      }
    });
  });

  it('emits structured logger callbacks for install and verify failures', async () => {
    const storeRoot = await createStoreRoot();
    const fixtureRoot = await createStoreRoot();
    const events = [];
    const versionary = new Versionary(storeRoot, {
      logger: {
        debug: (message) => events.push(['debug', message]),
        info: (message) => events.push(['info', message]),
        warn: (message) => events.push(['warn', message]),
        error: (message) => events.push(['error', message]),
      }
    });

    try {
      await createLocalFixture(fixtureRoot, 42);

      await assert.rejects(
        () =>
          versionary.install(`@example/temp-cjs-fixture@file:${fixtureRoot}`, {
            verify: {
              mode: 'require',
              hook: async () => false
            }
          }),
        (error) => error?.code === 'ERR_VERSIONARY_VERIFY_FAILED'
      );

      assert.ok(events.some(([level, message]) => level === 'debug' && message === 'Initializing store'));
      assert.ok(events.some(([level, message]) => level === 'info' && message === 'Installing package'));
      assert.ok(events.some(([level, message]) => level === 'warn' && message === 'Verification failed'));
      assert.ok(events.some(([level, message]) => level === 'error' && message === 'Install failed, rolling back store state'));
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
      await rm(storeRoot, { recursive: true, force: true });
    }
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

  it('lists installed packages and filters by package name', async () => {
    await withVersionary(async ({ versionary }) => {
      const cjsFixturePath = path.join(fixturesRoot, 'cjs-fixture');
      await versionary.install('abbrev', '1.1.1');
      await versionary.install('@example/cjs-fixture', `file:${cjsFixturePath}`);

      const all = await versionary.list();
      assert.equal(all.length, 2);
      assert.ok(all.every((entry) => entry.alias && entry.installPath));

      const abbrevOnly = await versionary.list('abbrev');
      assert.equal(abbrevOnly.length, 1);
      assert.equal(abbrevOnly[0].packageName, 'abbrev');

      const none = await versionary.list('nonexistent');
      assert.equal(none.length, 0);
    });
  });

  it('rejects invalid install and prune inputs', async () => {
    await withVersionary(async ({ versionary }) => {
      await assert.rejects(
        () => versionary.install(''),
        (error) => error?.code === 'ERR_VERSIONARY_INVALID_TARGET'
      );

      await assert.rejects(
        () => versionary.install(42),
        (error) => error?.code === 'ERR_VERSIONARY_INVALID_TARGET'
      );

      await assert.rejects(
        () => versionary.prune(''),
        (error) => error?.code === 'ERR_VERSIONARY_INVALID_TARGET'
      );
    });
  });

  it('surfaces a missing store manifest after initialization', async () => {
    await withVersionary(async ({ storeRoot, versionary }) => {
      await versionary.clean();
      await rm(path.join(storeRoot, 'package.json'));

      await assert.rejects(
        () => versionary.list(),
        (error) => error?.code === 'ERR_VERSIONARY_STORE_INIT_FAILED'
      );
    });
  });
});
