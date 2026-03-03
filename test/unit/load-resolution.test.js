import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { Versionary } from '../../src/versionary.js';
import { requirePackage } from '../../src/load/require-package.js';
import { resolveImportEntry, resolveRequireEntry } from '../../src/load/resolve-package-entry.js';
import { getAliasInstallPath } from '../../src/utils/paths.js';

async function createTempDir() {
  return mkdtemp(path.join(os.tmpdir(), 'versionary-unit-'));
}

describe('load resolution', () => {
  it('resolves conditional exports for import and require entrypoints', async () => {
    const tempDir = await createTempDir();
    const alias = '@versionary/conditional--1.0.0';
    const installPath = getAliasInstallPath(tempDir, alias);

    try {
      await mkdir(installPath, { recursive: true });
      await writeFile(path.join(installPath, 'package.json'), JSON.stringify({
        name: alias,
        type: 'module',
        exports: {
          '.': [
            null,
            {
              browser: './browser.js',
              node: {
                import: './node.mjs',
                require: './node.cjs'
              }
            }
          ]
        }
      }), 'utf8');
      await writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');

      assert.equal(await resolveImportEntry(tempDir, alias), path.join(installPath, 'node.mjs'));
      assert.equal((await resolveRequireEntry(tempDir, alias)).resolvedPath, path.join(installPath, 'node.cjs'));
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('falls back to module, main, and index entrypoints', async () => {
    const tempDir = await createTempDir();
    const moduleAlias = '@versionary/module-fallback--1.0.0';
    const cjsAlias = '@versionary/cjs-fallback--1.0.0';

    try {
      await mkdir(getAliasInstallPath(tempDir, moduleAlias), { recursive: true });
      await mkdir(getAliasInstallPath(tempDir, cjsAlias), { recursive: true });
      await writeFile(
        path.join(getAliasInstallPath(tempDir, moduleAlias), 'package.json'),
        JSON.stringify({
          name: moduleAlias,
          type: 'module',
          module: './esm-entry.js'
        }),
        'utf8'
      );
      await writeFile(
        path.join(getAliasInstallPath(tempDir, cjsAlias), 'package.json'),
        JSON.stringify({
          name: cjsAlias
        }),
        'utf8'
      );
      await writeFile(path.join(tempDir, 'package.json'), JSON.stringify({ type: 'module' }), 'utf8');

      assert.equal(
        await resolveImportEntry(tempDir, moduleAlias),
        path.join(getAliasInstallPath(tempDir, moduleAlias), 'esm-entry.js')
      );
      assert.equal(
        (await resolveRequireEntry(tempDir, cjsAlias)).resolvedPath,
        path.join(getAliasInstallPath(tempDir, cjsAlias), 'index.js')
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('wraps unsupported require paths and infers verify modes through the public API', async () => {
    const tempDir = await createTempDir();
    const importOnlyAlias = '@versionary/import-only--1.0.0';
    const dualAlias = '@versionary/dual--1.0.0';
    const cjsAlias = '@versionary/cjs--1.0.0';
    const versionary = new Versionary(tempDir);

    try {
      await versionary.clean();

      for (const alias of [importOnlyAlias, dualAlias, cjsAlias]) {
        await mkdir(getAliasInstallPath(tempDir, alias), { recursive: true });
      }

      await writeFile(
        path.join(getAliasInstallPath(tempDir, importOnlyAlias), 'package.json'),
        JSON.stringify({
          name: importOnlyAlias,
          type: 'module',
          exports: './index.js'
        }),
        'utf8'
      );
      await writeFile(path.join(getAliasInstallPath(tempDir, importOnlyAlias), 'index.js'), 'export default 1;\n', 'utf8');

      await writeFile(
        path.join(getAliasInstallPath(tempDir, dualAlias), 'package.json'),
        JSON.stringify({
          name: dualAlias,
          type: 'module',
          exports: {
            '.': {
              import: './index.js',
              require: './index.cjs'
            }
          }
        }),
        'utf8'
      );
      await writeFile(path.join(getAliasInstallPath(tempDir, dualAlias), 'index.js'), 'export default 1;\n', 'utf8');
      await writeFile(path.join(getAliasInstallPath(tempDir, dualAlias), 'index.cjs'), 'module.exports = 1;\n', 'utf8');

      await writeFile(
        path.join(getAliasInstallPath(tempDir, cjsAlias), 'package.json'),
        JSON.stringify({
          name: cjsAlias,
          exports: {
            '.': {
              require: './index.cjs'
            }
          }
        }),
        'utf8'
      );
      await writeFile(path.join(getAliasInstallPath(tempDir, cjsAlias), 'index.cjs'), 'module.exports = 1;\n', 'utf8');

      const storePackagePath = path.join(tempDir, 'package.json');
      await writeFile(
        storePackagePath,
        JSON.stringify({
          name: 'versionary-store',
          private: true,
          type: 'module',
          dependencies: {
            [importOnlyAlias]: 'file:import-only',
            [dualAlias]: 'file:dual',
            [cjsAlias]: 'file:cjs'
          },
          versionary: {
            storeVersion: 1,
            managedScope: '@versionary',
            registry: 'https://registry.npmjs.org/',
            scopes: {},
            packages: {
              [importOnlyAlias]: {
                packageName: '@example/import-only',
                requestedSpec: 'file:import-only',
                dependencySpec: 'file:import-only',
                resolvedType: 'directory',
                resolvedLocator: 'file:import-only',
                installedAt: new Date().toISOString()
              },
              [dualAlias]: {
                packageName: '@example/dual',
                requestedSpec: 'file:dual',
                dependencySpec: 'file:dual',
                resolvedType: 'directory',
                resolvedLocator: 'file:dual',
                installedAt: new Date().toISOString()
              },
              [cjsAlias]: {
                packageName: '@example/cjs',
                requestedSpec: 'file:cjs',
                dependencySpec: 'file:cjs',
                resolvedType: 'directory',
                resolvedLocator: 'file:cjs',
                installedAt: new Date().toISOString()
              }
            }
          }
        }, null, 2),
        'utf8'
      );

      await assert.rejects(
        () => requirePackage(tempDir, importOnlyAlias),
        (error) => error?.code === 'ERR_VERSIONARY_REQUIRE_UNSUPPORTED'
      );

      assert.equal((await versionary.verify(importOnlyAlias)).mode, 'import');
      assert.equal((await versionary.verify(dualAlias)).mode, 'both');
      assert.equal((await versionary.verify(cjsAlias)).mode, 'require');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('infers verify modes for non-module export shapes and rethrows non-ESM require failures', async () => {
    const tempDir = await createTempDir();
    const bothAlias = '@versionary/both-cjs--1.0.0';
    const importOnlyAlias = '@versionary/import-cjs--1.0.0';
    const brokenAlias = '@versionary/broken-cjs--1.0.0';
    const versionary = new Versionary(tempDir);

    try {
      await versionary.clean();

      for (const alias of [bothAlias, importOnlyAlias, brokenAlias]) {
        await mkdir(getAliasInstallPath(tempDir, alias), { recursive: true });
      }

      await writeFile(
        path.join(getAliasInstallPath(tempDir, bothAlias), 'package.json'),
        JSON.stringify({
          name: bothAlias,
          exports: [
            {
              '.': './ignored.js'
            },
            {
              import: './import.js',
              require: './require.cjs'
            }
          ]
        }),
        'utf8'
      );
      await writeFile(path.join(getAliasInstallPath(tempDir, bothAlias), 'import.js'), 'export default 1;\n', 'utf8');
      await writeFile(path.join(getAliasInstallPath(tempDir, bothAlias), 'require.cjs'), 'module.exports = 1;\n', 'utf8');

      await writeFile(
        path.join(getAliasInstallPath(tempDir, importOnlyAlias), 'package.json'),
        JSON.stringify({
          name: importOnlyAlias,
          exports: {
            nested: {
              import: './import.js'
            }
          }
        }),
        'utf8'
      );
      await writeFile(path.join(getAliasInstallPath(tempDir, importOnlyAlias), 'import.js'), 'export default 1;\n', 'utf8');

      await writeFile(
        path.join(getAliasInstallPath(tempDir, brokenAlias), 'package.json'),
        JSON.stringify({
          name: brokenAlias,
          main: './missing.cjs'
        }),
        'utf8'
      );

      await writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'versionary-store',
          private: true,
          type: 'module',
          dependencies: {
            [bothAlias]: 'file:both',
            [importOnlyAlias]: 'file:import-only',
            [brokenAlias]: 'file:broken'
          },
          versionary: {
            storeVersion: 1,
            managedScope: '@versionary',
            registry: 'https://registry.npmjs.org/',
            scopes: {},
            packages: {
              [bothAlias]: {
                packageName: '@example/both-cjs',
                requestedSpec: 'file:both',
                dependencySpec: 'file:both',
                resolvedType: 'directory',
                resolvedLocator: 'file:both',
                installedAt: new Date().toISOString()
              },
              [importOnlyAlias]: {
                packageName: '@example/import-cjs',
                requestedSpec: 'file:import-only',
                dependencySpec: 'file:import-only',
                resolvedType: 'directory',
                resolvedLocator: 'file:import-only',
                installedAt: new Date().toISOString()
              },
              [brokenAlias]: {
                packageName: '@example/broken-cjs',
                requestedSpec: 'file:broken',
                dependencySpec: 'file:broken',
                resolvedType: 'directory',
                resolvedLocator: 'file:broken',
                installedAt: new Date().toISOString()
              }
            }
          }
        }, null, 2),
        'utf8'
      );

      assert.equal((await versionary.verify(bothAlias)).mode, 'both');
      assert.equal((await versionary.verify(importOnlyAlias)).mode, 'import');

      await assert.rejects(
        () => requirePackage(tempDir, brokenAlias),
        (error) => error?.code === 'MODULE_NOT_FOUND'
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
