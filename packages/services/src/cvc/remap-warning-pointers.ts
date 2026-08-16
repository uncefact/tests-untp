import type { ClaimSourceMap } from '../data-model-bridges/types.js';

/** The part of a conformity warning this module reads and rewrites. */
type PointedWarning = { pointer?: string };

/**
 * Rewrites conformity warning pointers so they resolve in the document the
 * caller submitted, dropping the pointer where they cannot (#753).
 *
 * `validateConformityClaim` emits pointers into the extracted claim, which is
 * a synthesised projection rather than a sub-document of the credential, so a
 * pointer cannot be carried over by prepending a wrapper path. The extractor
 * records where each projected value came from, and this substitutes that
 * recorded path.
 *
 * It fails closed. A warning keeps its pointer only when the map has an entry
 * for it and the resulting path resolves in the document; otherwise the
 * pointer is dropped and the warning's other fields carry the diagnosis. A
 * pointer that survived untranslated would name a location in an object the
 * caller cannot obtain, which is the defect this exists to remove. Warnings
 * whose subject is absent by definition, a criterion the claim never declared
 * or an unspecified profile, have no entry in the map and so lose their
 * pointer here.
 *
 * @param warnings - Warnings as the validator returned them.
 * @param sourceMap - Claim-to-subject paths from the extractor, or `undefined`
 *   when the bridge records no provenance.
 * @param document - The document the returned pointers should resolve in.
 * @param basePath - JSON pointer from `document` to the subject the claim was
 *   extracted from, since the extractor records subject-relative paths.
 * @returns New warning objects; the input is not modified.
 */
export function remapWarningPointers<W extends PointedWarning>(
  warnings: readonly W[],
  sourceMap: ClaimSourceMap | undefined,
  document: unknown,
  basePath: string,
): RemappedWarning<W>[] {
  return warnings.map((warning) => {
    if (warning.pointer === undefined) return warning;

    const remapped = isWellFormed(warning.pointer) ? join(basePath, ownEntry(sourceMap, warning.pointer)) : undefined;
    if (remapped === undefined || !resolves(document, remapped)) {
      const { pointer: _dropped, ...rest } = warning;
      return rest;
    }
    return { ...warning, pointer: remapped };
  });
}

/**
 * A warning after remapping: `pointer` is optional whatever the input said,
 * because a pointer that cannot be translated is dropped. Returning the input
 * type unchanged would promise callers a pointer this function may remove.
 */
export type RemappedWarning<W extends PointedWarning> = Omit<W, 'pointer'> & { pointer?: string };

/**
 * The map's own entry for a claim pointer, ignoring anything reached through
 * the prototype chain: a polluted prototype must not be able to put a pointer
 * back into a response that carries an empty map.
 */
function ownEntry(sourceMap: ClaimSourceMap | undefined, claimPointer: string): string | undefined {
  if (!sourceMap || !Object.prototype.hasOwnProperty.call(sourceMap, claimPointer)) return undefined;
  // The type says string, but this is a public helper and a caller can hand it
  // a map built at runtime; anything else is treated as no entry rather than
  // thrown from an advisory path.
  const subjectPath = sourceMap[claimPointer];
  return typeof subjectPath === 'string' ? subjectPath : undefined;
}

/**
 * Joins the consumer's base path to a recorded subject path, rejecting either
 * half if it is not a well-formed pointer. Concatenating without this check
 * lets a malformed entry address a sibling of the subject rather than a value
 * inside it: `/credentialSubject` and `Elsewhere/id` would otherwise join into
 * `/credentialSubjectElsewhere/id`.
 */
function join(basePath: string, subjectPath: string | undefined): string | undefined {
  if (subjectPath === undefined) return undefined;
  if (!isWellFormed(basePath) || !isWellFormed(subjectPath)) return undefined;
  return `${basePath}${subjectPath}`;
}

/**
 * Whether a string is a syntactically valid JSON pointer: empty, or a series
 * of `/`-prefixed tokens whose only `~` uses are the `~0` and `~1` escapes
 * RFC 6901 section 3 defines. An unknown escape such as `~2` is invalid
 * syntax, not a literal.
 */
function isWellFormed(pointer: string): boolean {
  if (pointer === '') return true;
  return pointer.startsWith('/') && !/~(?![01])/.test(pointer);
}

/**
 * Whether an RFC 6901 pointer addresses something in `document`. Used as the
 * final check on a remapped pointer, so a stale or malformed mapping drops the
 * pointer instead of publishing a path the caller cannot follow.
 */
function resolves(document: unknown, pointer: string): boolean {
  if (!isWellFormed(pointer)) return false;
  if (pointer === '') return true;

  let current = document;
  for (const rawToken of pointer.slice(1).split('/')) {
    const key = rawToken.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(current)) {
      // Array indices are decimal, without leading zeros, per RFC 6901.
      if (!/^(0|[1-9][0-9]*)$/.test(key)) return false;
      const index = Number(key);
      if (index >= current.length) return false;
      current = current[index];
      continue;
    }
    if (current === null || typeof current !== 'object') return false;
    if (!Object.prototype.hasOwnProperty.call(current, key)) return false;
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}
