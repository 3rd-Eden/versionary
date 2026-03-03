/**
 * Parses a target string into either a managed alias or a selector target.
 *
 * @param {string} target
 * @returns {{ type: 'alias', alias: string } | { type: 'selector', name: string, selector: string } | null}
 */
export function parseStringTarget(target) {
  if (typeof target !== 'string' || !target) {
    return null;
  }

  if (target.startsWith('@versionary/')) {
    return { type: 'alias', alias: target };
  }

  const atIndex = target.lastIndexOf('@');
  if (atIndex <= 0) {
    return null;
  }

  return {
    type: 'selector',
    name: target.slice(0, atIndex),
    selector: target.slice(atIndex + 1),
  };
}
