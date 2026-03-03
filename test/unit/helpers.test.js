import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { parseInstallSpec } from '../../src/install/parse-spec.js';
import { packageNameToSegment } from '../../src/utils/package-name-segment.js';
import { getDefaultStoreRoot } from '../../src/utils/paths.js';
import { parseStringTarget } from '../../src/resolve/parse-string-target.js';
import { resolveSemverSelector } from '../../src/resolve/resolve-semver-selector.js';

describe('helpers', () => {
  it('uses the fixed default store root', () => {
    assert.equal(getDefaultStoreRoot(), path.join(os.homedir(), '.versionary'));
  });

  it('flattens scoped package names into managed alias segments', () => {
    assert.equal(packageNameToSegment('@example/pkg'), 'example__pkg');
    assert.equal(packageNameToSegment('left-pad'), 'left-pad');
  });

  it('parses alias and selector target strings', () => {
    assert.deepEqual(parseStringTarget('@versionary/example__pkg--1.2.3'), {
      type: 'alias',
      alias: '@versionary/example__pkg--1.2.3',
    });

    assert.deepEqual(parseStringTarget('@example/pkg@12'), {
      type: 'selector',
      name: '@example/pkg',
      selector: '12',
    });
  });

  it('parses single-string install specs for scoped and unscoped packages', () => {
    const parsedUnscoped = parseInstallSpec('abbrev@3.0.1', undefined, process.cwd());
    const parsedScoped = parseInstallSpec('@types/node@24.0.0', undefined, process.cwd());
    const parsedLatest = parseInstallSpec('abbrev', undefined, process.cwd());

    assert.equal(parsedUnscoped.name, 'abbrev');
    assert.equal(parsedUnscoped.rawSpec, '3.0.1');
    assert.equal(parsedScoped.name, '@types/node');
    assert.equal(parsedScoped.rawSpec, '24.0.0');
    assert.equal(parsedLatest.name, 'abbrev');
    assert.equal(parsedLatest.rawSpec, 'latest');
  });

  it('resolves latest and semver selectors against registry records only', () => {
    const records = [
      {
        alias: '@versionary/example__pkg--1.2.0',
        resolvedType: 'registry',
        resolvedVersion: '1.2.0',
      },
      {
        alias: '@versionary/example__pkg--1.5.0',
        resolvedType: 'registry',
        resolvedVersion: '1.5.0',
      },
      {
        alias: '@versionary/example__pkg--2.0.0',
        resolvedType: 'registry',
        resolvedVersion: '2.0.0',
      },
    ];

    assert.equal(resolveSemverSelector('@example/pkg', 'latest', records)?.alias, '@versionary/example__pkg--2.0.0');
    assert.equal(resolveSemverSelector('@example/pkg', '1', records)?.alias, '@versionary/example__pkg--1.5.0');
    assert.equal(
      resolveSemverSelector('@example/pkg', '1.2.0', records)?.alias,
      '@versionary/example__pkg--1.2.0'
    );
  });
});
