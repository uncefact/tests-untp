/**
 * Conformity-scheme family layer over the shared per-instance model (ADR-041).
 *
 * The shared model in artefactCollection.ts owns the generic mechanics; this file owns the
 * scheme-specific parts: the content hash that identifies a scheme, when its result is terminal,
 * and its card title and subtitle copy.
 */

import { hashContent } from '@/lib/hash';
import { detectSchemeVersion } from '@/lib/schemeValidation';
import type { StoredScheme, TestStep } from '@/types';
import { TestCaseStatus } from '../../constants';

/** The spaced family label shown on every scheme card (final hi-fi and #677). */
export const SCHEME_FAMILY_LABEL = 'Conformity Scheme';

/** A scheme's identity is the content hash of its document, so identical content is one instance. */
export function schemeContentHash(decoded: Record<string, unknown>): string {
  return hashContent(decoded);
}

/** A scheme's pipeline is terminal once every step has settled to success or failure. */
export function schemeIsTerminal(steps: TestStep[]): boolean {
  return (
    steps.length > 0 &&
    steps.every((step) => step.status === TestCaseStatus.SUCCESS || step.status === TestCaseStatus.FAILURE)
  );
}

/** Card title: the scheme name, else a URL's final path segment, else the filename, else the family label. Never the raw URL. */
export function schemeTitle(scheme: StoredScheme): string {
  const name = scheme.decoded?.name;
  if (typeof name === 'string' && name.length > 0) return name;

  const source = scheme.source;
  if (source?.kind === 'url') {
    const segment = finalPathSegment(source.url);
    if (segment) return segment;
  }
  if (source?.kind === 'file' && source.filename.length > 0) return source.filename;

  return SCHEME_FAMILY_LABEL;
}

/** Always-on subtitle: the family label with the detected UNTP context version when there is one. */
export function schemeSubtitle(scheme: StoredScheme): string {
  const version = detectSchemeVersion(scheme.decoded);
  return version ? `${SCHEME_FAMILY_LABEL} (v${version})` : SCHEME_FAMILY_LABEL;
}

function finalPathSegment(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : url.hostname;
  } catch {
    return undefined;
  }
}
