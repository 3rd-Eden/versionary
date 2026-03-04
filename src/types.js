/**
 * @typedef {{
 *   packageName: string,
 *   requestedSpec: string,
 *   dependencySpec?: string,
 *   resolvedType: string,
 *   resolvedVersion?: string,
 *   resolvedLocator?: string,
 *   integrity?: string,
 *   gitSha?: string,
 *   installedAt?: string,
 *   artifactPath?: string
 * }} PackageRecord
 */

/**
 * @typedef {{
 *   storeVersion?: number,
 *   managedScope?: string,
 *   registry?: string,
 *   scopes?: Record<string, string>,
 *   scopedRegistries?: Record<string, string>,
 *   packages?: Record<string, PackageRecord>
 * }} VersionaryMeta
 */

/**
 * @typedef {{
 *   name?: string,
 *   private?: boolean,
 *   type?: string,
 *   dependencies?: Record<string, string>,
 *   versionary?: VersionaryMeta
 * } & Record<string, unknown>} StorePackage
 */

export {};
