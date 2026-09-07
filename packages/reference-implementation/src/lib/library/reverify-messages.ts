/**
 * The caller-facing messages the re-verify route returns, kept out of the
 * route module because Next.js permits a route file to export only its
 * handlers and its route configuration, and refuses the build otherwise.
 *
 * The published OpenAPI examples and the suites that pin them read the same
 * constants, so the contract quotes the literal the code produces rather than
 * a copy of it.
 */

export const BODY_MUST_BE_EMPTY_MESSAGE =
  'The re-verification request body must be empty. Supplying a decryption key is not supported on this endpoint yet.';
