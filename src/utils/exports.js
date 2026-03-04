/**
 * Checks whether a package exports structure contains a specific condition.
 *
 * @param {any} exportsField
 * @param {string} condition
 * @returns {boolean}
 */
export function hasExportCondition(exportsField, condition) {
  if (!exportsField || typeof exportsField === 'string') {
    return false;
  }

  if (Array.isArray(exportsField)) {
    return exportsField.some((item) => hasExportCondition(item, condition));
  }

  if (typeof exportsField === 'object' && condition in exportsField) {
    return true;
  }

  return Object.values(exportsField).some((item) => hasExportCondition(item, condition));
}
