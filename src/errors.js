/**
 * Error type used by the versionary package.
 */
export class VersionaryError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   * @param {ErrorOptions} [options]
   */
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = 'VersionaryError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Creates a {@link VersionaryError}.
 *
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @param {ErrorOptions} [options]
 * @returns {VersionaryError}
 */
export function createError(code, message, details = {}, options = {}) {
  return new VersionaryError(code, message, details, options);
}
