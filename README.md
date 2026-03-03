# versionary

Manage multiple installed versions of the same npm package in a dedicated local store.

`versionary` installs packages into a private store, rewrites them under the fixed `@versionary` namespace, and lets you load them later by exact version, semver selector, or installed `latest`.

## Requirements

- Node.js `>= 22`
- ESM-only consumers

## Install

```bash
npm install @versionary/versionary
```

## Why

Normal npm installs give you one resolved version per package location. `versionary` gives you a separate managed store so multiple versions can coexist at once.

Examples:

- install `abbrev@1.1.1` and `abbrev@3.0.1` side by side
- load the highest installed `12.x` of a package with `@scope/pkg@12`
- wipe the whole managed store during `postinstall` or after a bad verify

## How It Works

When you install a package through `versionary`:

- the package is installed into a dedicated store, defaulting to `~/.versionary`
- the store root gets a `package.json` with `private: true`
- the installed dependency is recorded in that root `package.json.dependencies`
- metadata is recorded under `package.json.versionary`
- the installed package manifest is rewritten:
  - registry installs become `@versionary/<package-name>--<resolved-version>`
  - non-registry installs become `@versionary/<package-name>--<short-hash>`
  - `version` is rewritten to `npm://<package>@<version>` or `npm://<package>#<hash>`

For scoped source packages, the package name segment is flattened:

- `@example/pkg` -> `@versionary/example__pkg--<suffix>`

## API

```js
import { Versionary } from '@versionary/versionary';

const versionary = new Versionary(storeRoot, options);
```

Constructor:

```js
new Versionary(storeRoot, {
  registry,
  scopes,
  npmConfig,
  authTokens,
  cacheDir,
  tempDir,
  logger
});
```

Rules:

- `storeRoot` defaults to `~/.versionary`
- the managed scope is always `@versionary`
- the managed scope is not configurable

### `install(nameOrSpecifier, specOrOptions, options = {})`

Installs one managed package variant.

```js
const record = await versionary.install('abbrev@3.0.1');
```

Supported call forms:

```js
await versionary.install('abbrev@3.0.1');
await versionary.install('abbrev', '3.0.1');
await versionary.install('abbrev@3.0.1', { verify: true });
```

Supported spec types:

- registry versions, ranges, and tags
- git URLs
- remote tarballs
- local tarballs
- local directories

Install options:

```js
{
  force: false,
  prune: false,
  verify: false
}
```

or:

```js
{
  force: true,
  prune: true,
  verify: {
    mode: 'auto',
    hook: async (loaded, record) => {}
  }
}
```

`prune: true` keeps the newly resolved install and removes the other installed variants of the same package after the install and any requested verification succeed.

This is useful for moving selectors such as `latest` or semver ranges:

```js
await versionary.install('abbrev@latest', { prune: true });
await versionary.install('abbrev@2', { prune: true });
```

Returned record shape:

```js
{
  alias,
  packageName,
  requestedSpec,
  dependencySpec,
  resolvedType,
  resolvedVersion,
  resolvedLocator,
  integrity,
  gitSha,
  installedAt,
  artifactPath,
  installPath
}
```

### `import(target)`

Loads a managed package as ESM.

```js
const mod = await versionary.import('abbrev@latest');
```

### `require(target)`

Loads a managed package through CommonJS semantics, but stays async on purpose.

```js
const value = await versionary.require('abbrev@1');
```

If the package does not expose a CJS entrypoint, `require()` throws `ERR_VERSIONARY_REQUIRE_UNSUPPORTED`.

### `verify(target, options = {})`

Loads the package and optionally runs a verification hook.

```js
const result = await versionary.verify('abbrev@latest', {
  mode: 'auto',
  hook: async (loaded, record) => {
    return typeof loaded === 'function';
  }
});
```

Modes:

- `'auto'`
- `'import'`
- `'require'`
- `'both'`

`auto` behavior:

- ESM-only packages verify with `import`
- CJS-only packages verify with `require`
- dual-mode packages verify with both

### `uninstall(target)`

Removes one managed install.

```js
await versionary.uninstall('abbrev@latest');
await versionary.uninstall({ alias: '@versionary/abbrev--1.1.1' });
```

### `prune(packageName)`

Removes all installed variants for one original package name.

```js
await versionary.prune('abbrev');
```

### `clean()`

Fully resets the managed store.

This is intentionally destructive and is meant for cases like:

- bad installs
- failed verify flows
- release transitions
- consumer `postinstall` hooks

```js
await versionary.clean();
```

After `clean()`:

- the store still exists
- the root `package.json` still exists
- registry config metadata is preserved
- all installed packages are gone

## Target Formats

All load, verify, and uninstall methods accept these target forms:

- managed alias string
- selector string
- `{ alias }`
- `{ name, spec }`
- an install record returned from `install()`

Examples:

```js
await versionary.import('@versionary/abbrev--3.0.1');
await versionary.import('abbrev@3.0.1');
await versionary.import('abbrev@3');
await versionary.import('abbrev@latest');
await versionary.require({ name: 'abbrev', spec: '3.0.1' });
```

Selector behavior:

- selectors only resolve among already installed registry-backed versions
- `latest` means the highest installed version
- `3` means the highest installed `3.x.x`
- non-registry installs cannot be resolved with semver selectors

## Store Layout

```text
<storeRoot>/
  package.json
  package-lock.json
  node_modules/
  .versionary/
    locks/
    tmp/
    artifacts/
    metadata/
    cache/
```

The store root `package.json` is the source of truth.

Example:

```json
{
  "name": "versionary-store",
  "private": true,
  "type": "module",
  "dependencies": {
    "@versionary/abbrev--3.0.1": "npm:abbrev@3.0.1"
  },
  "versionary": {
    "storeVersion": 1,
    "managedScope": "@versionary",
    "registry": "https://registry.npmjs.org/",
    "scopes": {},
    "packages": {
      "@versionary/abbrev--3.0.1": {
        "packageName": "abbrev",
        "requestedSpec": "3.0.1",
        "dependencySpec": "npm:abbrev@3.0.1",
        "resolvedType": "registry",
        "resolvedVersion": "3.0.1",
        "resolvedLocator": "https://registry.npmjs.org/abbrev/-/abbrev-3.0.1.tgz"
      }
    }
  }
}
```

## Registry Configuration

Custom registries are supported through the constructor:

```js
const versionary = new Versionary(undefined, {
  registry: 'https://registry.example.test/',
  scopes: {
    '@internal': 'https://npm.internal.example/'
  },
  authTokens: {
    'https://registry.example.test/': process.env.DEFAULT_NPM_TOKEN,
    'https://npm.internal.example/': process.env.INTERNAL_NPM_TOKEN
  }
});
```

Notes:

- auth tokens are used for npm-compatible fetch/install operations
- auth tokens are not persisted to disk

## Example

```js
import { Versionary } from '@versionary/versionary';

const versionary = new Versionary();

await versionary.install('abbrev', '1.1.1');
await versionary.install('abbrev', '3.0.1');

const newest = await versionary.require('abbrev@latest');
const legacy = await versionary.require('abbrev@1');

console.log(typeof newest);
console.log(typeof legacy);
```

With local packages:

```js
const versionary = new Versionary();

const record = await versionary.install('@example/dual-fixture', 'file:./fixtures/dual-fixture');

const esm = await versionary.import(record);
const verify = await versionary.verify(record, { mode: 'both' });
```

## Errors

Versionary throws `VersionaryError` instances with a stable `code` and a `details` object.

When debugging an error, check:

- `error.code`
- `error.details`
- `error.cause`

### Error Reference

| Code | When it happens | Typical cause | What to do |
| --- | --- | --- | --- |
| `ERR_VERSIONARY_INVALID_TARGET` | A load, verify, or uninstall target cannot be resolved | The target string is malformed, the `{ name, spec }` target is ambiguous, or the target shape is unsupported | Use a valid target such as `abbrev@3.0.1`, `abbrev@latest`, `{ alias }`, or an install record. If `{ name, spec }` is ambiguous, use the concrete managed alias instead. |
| `ERR_VERSIONARY_INVALID_SELECTOR` | A selector string is not valid semver syntax | Inputs like `pkg@not-a-range` or malformed range expressions | Use an exact version, a valid semver range, a major shorthand like `pkg@3`, or `pkg@latest`. |
| `ERR_VERSIONARY_UNSUPPORTED_SELECTOR` | A selector is used against installs that are not registry-backed semver versions | Trying `@example/pkg@latest` for git, tarball, or local directory installs | Address non-registry installs by managed alias or by `{ name, spec }`. |
| `ERR_VERSIONARY_NOT_INSTALLED` | The requested package or alias does not exist in the managed store | The package was never installed, was removed by `uninstall()` or `clean()`, or the selector does not match any installed version | Call `install()` first, check the selector you passed, or inspect the store root `package.json` for what is actually installed. |
| `ERR_VERSIONARY_INSTALL_FAILED` | The install pipeline failed after resolution started | Registry/network issues, auth failures, npm reify failures, or manifest rewrite failures | Check `error.cause` first. Verify registry reachability, VPN/auth configuration, write permissions for the store root, and the package spec you passed. If the store looks inconsistent after a failed install, run `clean()` and retry. |
| `ERR_VERSIONARY_VERIFY_FAILED` | A verification step failed | The package could not be loaded in the selected mode, or your custom verify hook threw or returned `false` | Inspect `error.cause` or the `verify()` result error. If the package is ESM-only, use `import` mode. If your hook failed, relax or fix the hook logic. |
| `ERR_VERSIONARY_REQUIRE_UNSUPPORTED` | `require()` is used for a package without a CommonJS entrypoint | The package is ESM-only or does not expose a `require` condition | Use `await versionary.import(...)` instead of `require()`. |
| `ERR_VERSIONARY_LOCK_TIMEOUT` | Versionary cannot acquire the store lock in time | Another install, uninstall, prune, or clean operation is still running or left a stale lock behind | Wait for the other operation to finish. If the process crashed and the store is stuck, inspect `~/.versionary/.versionary/locks` or your custom store root and then retry. |
| `ERR_VERSIONARY_STORE_INIT_FAILED` | The managed store cannot be initialized or normalized | The store manifest is missing after init, is corrupted, or declares an unsupported managed scope | Check the store root `package.json`. If it is corrupted or managed by something else, remove it or point Versionary at a clean store directory. |

### Network and Registry Failures

Versionary supports custom registries and mirror registries, but network failures are not yet normalized into a dedicated Versionary-specific registry error.

In practice:

- some failures surface as `ERR_VERSIONARY_INSTALL_FAILED` with a network-related `cause`
- some early resolution failures from `pacote` may bubble up as lower-level fetch errors such as `ENOTFOUND`, `ECONNREFUSED`, or TLS/auth errors

For those failures:

- verify the registry URL is correct
- confirm the registry is reachable from your machine or VPN
- verify auth tokens and scope registry config
- retry after connectivity is restored
- run `clean()` if a failed install left the store in a bad state

## Development

Run the test suite:

```bash
npm test
```

The default test command:

- uses Node's built-in test runner
- enables `--experimental-test-coverage`
- enforces at least `90%` line coverage

Current tests cover:

- store bootstrap
- registry and local installs
- ESM and CJS loading
- selector resolution
- verify hooks
- uninstall, prune, and clean behavior
