import Arborist from '@npmcli/arborist';

/**
 * Reconciles the store's node_modules tree with its package manifest.
 *
 * @param {string} storeRoot
 * @param {Record<string, unknown>} npmOptions
 * @returns {Promise<void>}
 */
export async function reifyStore(storeRoot, npmOptions) {
  const arborist = new Arborist({
    ...npmOptions,
    path: storeRoot,
  });

  await arborist.reify({ save: true });
}
