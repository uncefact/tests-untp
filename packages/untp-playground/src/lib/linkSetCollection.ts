/**
 * Link-set family layer over the shared per-instance model (ADR-041).
 *
 * The shared model in artefactCollection.ts owns the generic mechanics; this file owns the
 * link-set-specific parts: the instance key, the card title and subtitle copy, and the rows the
 * expanded card lists for the credentials a link set points at.
 *
 * Unlike credentials and schemes, a link set's identity is its resolver URL (else the filename),
 * not a content hash: resolving the same identifier again must replace the card in place even
 * when the resolver's response changed (#811).
 */

import type { ArtefactSource, StoredLinkSet } from '@/types';

/** The family label shown as every link set card's subtitle (final hi-fi, #811). */
export const LINK_SET_FAMILY_LABEL = 'Link Set';

/**
 * Instance key: the source URL, else the filename. For resolved link sets the source URL is the
 * normalised request URL (the uploader's resolve mode stores it, never the post-redirect target, ADR-046);
 * for uploads it is the filename.
 */
export function linkSetKey(source: ArtefactSource | undefined): string {
  if (source?.kind === 'url') return source.url;
  if (source?.kind === 'file') return source.filename;
  return LINK_SET_FAMILY_LABEL;
}

/**
 * Card title: the resolver URL with the scheme and query stripped, else the filename, else the
 * first link context's anchor. The full URL (query included) lives in the source caption.
 */
export function linkSetTitle(linkSet: StoredLinkSet): string {
  const source = linkSet.source;
  if (source?.kind === 'url') {
    const stripped = stripForTitle(source.url);
    if (stripped) return stripped;
  }
  if (source?.kind === 'file' && source.filename.length > 0) return source.filename;

  const anchor = firstAnchor(linkSet.decoded);
  if (anchor) return anchor;

  return LINK_SET_FAMILY_LABEL;
}

export function linkSetSubtitle(): string {
  return LINK_SET_FAMILY_LABEL;
}

/** One link the link set carries, as the expanded card lists it (#811; Verify is #812). */
export interface LinkedCredentialRow {
  /** Best-effort label: the link's title or type, else the href's final path segment. */
  label: string;
  href: string;
  /** Whether the link identifies as a UNTP credential link (see isUntpCredentialLink). */
  credential: boolean;
  /**
   * Whether the target declares itself encrypted before fetch. The UNTP Identity Resolver
   * specification's Secure Targets section has the linkset carry the encryption method for an
   * encrypted target (example `"encryptionMethod": "AES-128"`), so the signal is a non-empty
   * `encryptionMethod` that is not "none", accepted as the spec's string form or RFC 9264's
   * array-of-strings extension form. `accessRole` alone is authorisation, not encryption (this
   * repository attaches it to unencrypted links too), so it does not mark the target. Like the
   * relation rule this is a hint, not a guarantee; decryption itself is #813.
   */
  encrypted: boolean;
  /** Whether the link points at a secondary identity resolver (see isSecondaryResolverLink, #974). */
  secondary: boolean;
}

function declaresEncryption(target: object): boolean {
  const raw = (target as { encryptionMethod?: unknown }).encryptionMethod;
  const values = Array.isArray(raw) ? raw : [raw];
  return values.some(
    (value) => typeof value === 'string' && value.trim().length > 0 && value.trim().toLowerCase() !== 'none',
  );
}

/**
 * Link relation types the UNTP Identity Resolver specification registers for credential links,
 * and the verifiable-credential media types it names for their targets
 * (https://untp.unece.org/docs/specification/IdentityResolver: dpp, dcc, dfr for credentials, dte
 * for traceability events; targets declare application/vc+jwt or application/vc+ld+json). The
 * spec calls these hints about intended content, not guarantees: actual content is validated
 * after dereferencing, which is what the Verify flow's detection does (#812).
 */
const UNTP_CREDENTIAL_LINK_RELATIONS = ['dpp', 'dcc', 'dfr', 'dte'];
const VC_MEDIA_TYPES = ['application/vc+jwt', 'application/vc+ld+json'];

/**
 * A link counts as a UNTP credential link when its relation is one of the UNTP-registered
 * credential relations, or when its target declares a verifiable-credential media type. The
 * relation may appear as the bare registered name (`dpp`), a CURIE (`untp:dpp`, the form the UNTP
 * v0.7 IDR API and this repository's Pyx IDR adapter use), or URI-qualified as a custom RFC 9264
 * relation (`https://.../dpp`, `https://...#dpp`), so the name is taken after the last `/`, `#`
 * or `:` separator. One exception: a target under a credential relation that declares `text/html`
 * is the credential's human viewing page (resolvers list a verify page beside the document under
 * the same relation), not a fetchable credential, so it counts as an other link. Suffix matching
 * is a product heuristic, not an RFC equivalence: RFC 9264 identifies extension relations by
 * their whole URI, and validation after fetch is what confirms the content either way.
 */
function mediaTypeEssence(targetMediaType: string | undefined): string | undefined {
  return typeof targetMediaType === 'string' ? targetMediaType.split(';')[0].trim().toLowerCase() : undefined;
}

function relationName(relation: string): string {
  const trimmed = relation.replace(/[/#:]+$/, '');
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('#'), trimmed.lastIndexOf(':'));
  return (separator === -1 ? trimmed : trimmed.slice(separator + 1)).toLowerCase();
}

export function isUntpCredentialLink(relation: string, targetMediaType: string | undefined): boolean {
  const mediaType = mediaTypeEssence(targetMediaType);
  if (mediaType && VC_MEDIA_TYPES.includes(mediaType)) return true;
  if (mediaType === 'text/html') return false;

  return UNTP_CREDENTIAL_LINK_RELATIONS.includes(relationName(relation));
}

/**
 * A link to a secondary identity resolver (#974): the UNTP Identity Resolver specification's
 * Secondary Resolvers section has a resolver return "a link to a secondary resolver service"
 * under the `idr` link type with an `application/linkset+json` target, delegating across
 * granularity (a coarse scheme handing off to the resolver that holds item-level links). The
 * relation accepts the same bare/CURIE/URI-qualified forms as the credential relations; the
 * media type must be the link set type, so an `idr`-named link to anything else stays an
 * other link.
 */
export function isSecondaryResolverLink(relation: string, targetMediaType: string | undefined): boolean {
  return relationName(relation) === 'idr' && mediaTypeEssence(targetMediaType) === 'application/linkset+json';
}

/**
 * Flattens RFC 9264 link context objects into displayable rows. A context's link relations are its
 * members other than `anchor` (the context's own subject), each holding an array of target objects
 * with an `href` (RFC 9264 §4.2.2 and §4.2.3). Targets without an `href` string are not links and
 * are dropped with a warning; an EMPTY `href` is valid RFC (it means the link set document itself,
 * §4.2.3) but is skipped silently here because a self-reference is not a linked credential.
 */
export function linkedCredentialRows(decoded: Record<string, unknown>): LinkedCredentialRow[] {
  const contexts = (decoded as { linkset?: unknown }).linkset;
  if (!Array.isArray(contexts)) return [];

  const rows: LinkedCredentialRow[] = [];
  for (const context of contexts) {
    if (typeof context !== 'object' || context === null) {
      console.warn('linkedCredentialRows: skipping a link context that is not an object', context);
      continue;
    }
    for (const [relation, value] of Object.entries(context as Record<string, unknown>)) {
      if (relation === 'anchor' || !Array.isArray(value)) continue;
      for (const target of value) {
        if (typeof target !== 'object' || target === null) continue;
        const href = (target as { href?: unknown }).href;
        if (typeof href !== 'string') {
          console.warn('linkedCredentialRows: skipping a link target with no href', target);
          continue;
        }
        if (href.length === 0) continue; // Valid self-reference (RFC 9264 §4.2.3), not a linked credential.
        const type = (target as { type?: unknown }).type;
        const title = (target as { title?: unknown }).title;
        const label =
          (typeof title === 'string' && title.length > 0 && title) ||
          (typeof type === 'string' && type.length > 0 && type) ||
          finalPathSegment(href) ||
          href;
        const mediaType = typeof type === 'string' ? type : undefined;
        const secondary = isSecondaryResolverLink(relation, mediaType);
        rows.push({
          label,
          href,
          credential: !secondary && isUntpCredentialLink(relation, mediaType),
          encrypted: declaresEncryption(target),
          secondary,
        });
      }
    }
  }
  return rows;
}

function stripForTitle(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return undefined;
  }
}

function firstAnchor(decoded: Record<string, unknown>): string | undefined {
  const contexts = (decoded as { linkset?: unknown }).linkset;
  if (!Array.isArray(contexts)) return undefined;
  for (const context of contexts) {
    const anchor = (context as { anchor?: unknown })?.anchor;
    if (typeof anchor === 'string' && anchor.length > 0) return anchor;
  }
  return undefined;
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
