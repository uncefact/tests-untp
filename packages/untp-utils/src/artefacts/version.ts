/**
 * UNTP spec version predicates.
 *
 * The v0.7.0 boundary is significant because v0.7.0 relocated the published
 * artefacts (see `./urls.ts`): schema origin, context unification, and the
 * introduction of the Conformity Vocabulary Catalogue.
 */

/** Returns true when the given UNTP version string is v0.7.0 or newer. */
export function isV070OrAbove(version: string): boolean {
  const match = version.match(/^(\d+)\.(\d+)/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 0 || (major === 0 && minor >= 7);
}
