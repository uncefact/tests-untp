/**
 * Domains UNTP publishes versioned contexts under. UNTP v0.7 and above
 * publish to `vocabulary.uncefact.org`; earlier versions (pre-0.7) were
 * published to `test.uncefact.org`. Both are kept in the matcher so
 * documents from either era resolve to a version string.
 */
export const UNTP_CONTEXT_DOMAINS = ['vocabulary.uncefact.org', 'test.uncefact.org'] as const;

/**
 * A version segment in a UNTP-published context path. Matches a path segment
 * shaped `/{major}.{minor}.{patch}[-prerelease]/`. The pre-release suffix
 * captures common forms (`-rc1`, `-alpha.2`, `-2024-05-21`, etc.).
 */
const UNTP_VERSION_PATH_SEGMENT = /\/(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)\//;

/**
 * Options for {@link detectVersionFromContext}.
 */
export interface DetectVersionFromContextOptions {
  /**
   * When set, only context URLs whose hostname contains this substring are
   * considered. Useful for extensions, where each extension publishes its own
   * versioned context under a domain distinct from the UNTP core context.
   *
   * When omitted, any UNTP context domain ({@link UNTP_CONTEXT_DOMAINS}) is
   * considered.
   */
  domain?: string;
}

/**
 * Derives the spec version from a UNTP document's `@context` by looking for a
 * path segment shaped `/{major}.{minor}.{patch}[-prerelease]/` inside a known
 * UNTP context URL.
 *
 * Works for any UNTP artefact that publishes a versioned context: credentials
 * (DPP, DCC, DFR, DIA, DTE), conformity schemes, identifier scheme registers,
 * etc. The function is data-only: it never fetches, never resolves contexts.
 *
 * @param doc - Any object that may carry an `@context` field. The field may
 *   be a string or an array; non-string entries in arrays are ignored.
 *   Non-object inputs return `undefined`.
 * @param options - {@link DetectVersionFromContextOptions}.
 * @returns The detected version string (for example `0.7.0` or `0.7.0-rc1`),
 *   or `undefined` when no matching UNTP context URL is found.
 *
 * @example
 * detectVersionFromContext({ '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'] });
 * // → '0.7.0'
 *
 * @example
 * detectVersionFromContext(extensionCredential, { domain: 'aatp.example.com' });
 * // → '0.5.0' (or whatever the extension publishes)
 */
export function detectVersionFromContext(
  doc: unknown,
  options: DetectVersionFromContextOptions = {},
): string | undefined {
  if (!doc || typeof doc !== 'object') {
    return undefined;
  }

  const contextField = (doc as { '@context'?: unknown })['@context'];
  const candidates = collectContextStrings(contextField);
  const matchesDomain = buildDomainMatcher(options.domain);

  for (const url of candidates) {
    if (!matchesDomain(url)) {
      continue;
    }
    const match = url.match(UNTP_VERSION_PATH_SEGMENT);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function collectContextStrings(context: unknown): string[] {
  if (typeof context === 'string') {
    return [context];
  }
  if (Array.isArray(context)) {
    const out: string[] = [];
    for (const entry of context) {
      if (typeof entry === 'string') {
        out.push(entry);
      }
    }
    return out;
  }
  return [];
}

function buildDomainMatcher(domain: string | undefined): (url: string) => boolean {
  if (domain) {
    return (url) => url.includes(domain);
  }
  return (url) => UNTP_CONTEXT_DOMAINS.some((d) => url.includes(d));
}
