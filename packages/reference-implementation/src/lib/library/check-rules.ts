/**
 * The seven checks a generation records (the coverage listed under ADR-055
 * decision 7; the generation row itself is ADR-053 decision 3; #955). Every
 * check is always present; NOT_RUN covers both "did not apply" and "did not
 * execute". The tuple is the roster used by the record type and noChecksRun,
 * so an eighth check is one edit and a build error everywhere it is not yet
 * handled.
 */
export const CHECK_NAMES = [
  'retrieval',
  'decryption',
  'digest',
  'proof',
  'status',
  'temporal',
  'schemaConformance',
] as const;

export type LibraryCheckName = (typeof CHECK_NAMES)[number];

/**
 * Checks whose failure makes a complete generation not conformant.
 * `temporal` is evidence and `schemaConformance` is advisory, so neither is
 * part of the blocking set.
 */
export const BLOCKING_CHECKS = [
  'retrieval',
  'decryption',
  'digest',
  'proof',
  'status',
] as const satisfies readonly LibraryCheckName[];

/**
 * Native acquisition and custody checks are hidden from the public summary.
 * Both the projector and the library-list SQL must apply this mask.
 */
export const NATIVE_MASKED_CHECKS = [
  'retrieval',
  'decryption',
  'digest',
] as const satisfies readonly LibraryCheckName[];

const nativeMaskedCheckSet = new Set<LibraryCheckName>(NATIVE_MASKED_CHECKS);

export function isNativeMasked(name: LibraryCheckName): boolean {
  return nativeMaskedCheckSet.has(name);
}
