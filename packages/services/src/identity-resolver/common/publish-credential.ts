import type { AccessRole, Link } from '../types.js';
import type { StorageRecord } from '../../storage/types.js';
import { EncryptionAlgorithm } from '../../encryption/encryption.interface.js';
import { constructVerifyURL } from '../../utils/helpers.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type BuildPublishLinksOptions = {
  /**
   * UNTP link relation type for the credential links. Callers resolve this
   * from the IDR service's configured default; gs1:sustainabilityInfo is
   * only the last-resort fallback when neither is supplied.
   */
  linkType?: string;
  /** URL of the machine-readable verification service (omit to skip) */
  machineVerificationUrl?: string;
  /** Base URL of the human-readable verification page (omit to skip) */
  humanVerificationUrl?: string;
  /**
   * BCP 47 language tags the credential resource is available in. Attached to
   * the credential link only; verification links are not language-specific.
   */
  hreflang?: string[];
  /**
   * Additional link relation types qualifying the credential link beyond its
   * primary `rel`. Attached to the credential link only.
   */
  additionalRels?: string[];
  /**
   * Whether the credential target URL is safe to publish in a public
   * directory. Attached to the credential link only. Unset round-trips
   * distinctly from `false`.
   */
  public?: boolean;
  /**
   * UNTP access roles governing who the published links are surfaced to.
   * Attached to the credential link and the human verification link; the
   * machine verification service link stays role-free.
   */
  accessRole?: AccessRole[];
};

// ── buildPublishLinks ────────────────────────────────────────────────────────

/**
 * Linkset `encryptionMethod` values for an encrypted target, per the UNTP
 * Identity Resolver API definition (its `Response.encryptionMethod` enum is
 * `none`, `AES-128`, `AES-256`; the Pyx resolver validates against the same
 * list). `none` is the unencrypted value and is never published here: an
 * unencrypted target simply omits the field.
 */
type LinksetEncryptionMethod = 'AES-128' | 'AES-256';

/**
 * Linkset `encryptionMethod` value for each algorithm a storage adapter can
 * report. The UNTP vocabulary names the family and key size only (no mode),
 * so the envelope's algorithm name (`aes-256-gcm`) cannot be published
 * verbatim; a decrypting consumer reads the envelope's own `type`. Keyed
 * exhaustively over {@link EncryptionAlgorithm}, so adding an algorithm
 * without deciding its published name fails to compile.
 */
const LINKSET_ENCRYPTION_METHOD_BY_ALGORITHM: Record<EncryptionAlgorithm, LinksetEncryptionMethod> = {
  [EncryptionAlgorithm.AES_256_GCM]: 'AES-256',
};

/**
 * Unreachable for a TypeScript producer (the record's key type is the enum),
 * but this is a public export a JavaScript caller can hand an arbitrary
 * string, and the alternative is an `encryptionMethod: undefined` that the
 * wire silently drops, publishing an encrypted target as if plain.
 */
function toLinksetEncryptionMethod(algorithm: EncryptionAlgorithm): LinksetEncryptionMethod {
  // Own-property check, not a lookup: an untyped caller passing an inherited
  // name such as "toString" or "__proto__" would otherwise read a value off
  // Object.prototype and publish it (or nothing) instead of failing.
  if (!Object.hasOwn(LINKSET_ENCRYPTION_METHOD_BY_ALGORITHM, algorithm)) {
    throw new Error(`No linkset encryptionMethod is defined for storage algorithm "${algorithm}"`);
  }
  return LINKSET_ENCRYPTION_METHOD_BY_ALGORITHM[algorithm];
}

/**
 * Builds the link set for publishing a credential to an Identity Resolver.
 *
 * Always includes a credential storage URI link.
 * Optionally prepends a machine verification link and appends a human
 * verification link depending on the provided options.
 *
 * When the storage record reports an encryption algorithm, the credential
 * link declares the linkset `encryptionMethod` for it, so a consumer can
 * tell an encrypted target from a plain one before fetching it. Neither
 * verification link carries it: they point at verification surfaces, not
 * the encrypted document.
 *
 * @param storage   - The storage record containing the credential URI and hash.
 * @param linkTitle - Human-readable title for the credential links.
 * @param options   - Optional verification URLs for machine and human verification.
 * @returns Array of 1–3 links: always includes the credential storage URI;
 *          optionally preceded by a machine verification link and followed
 *          by a human verification link.
 */
export function buildPublishLinks(
  storage: StorageRecord,
  linkTitle: string,
  options?: BuildPublishLinksOptions,
): Link[] {
  const links: Link[] = [];
  const credentialLinkType = options?.linkType ?? 'gs1:sustainabilityInfo';
  const accessRole = options?.accessRole && options.accessRole.length > 0 ? { accessRole: options.accessRole } : {};

  if (options?.machineVerificationUrl) {
    links.push({
      href: options.machineVerificationUrl,
      rel: 'gs1:verificationService',
      type: 'text/plain',
      title: 'VCKit verify service',
    });
  }

  links.push({
    href: storage.uri,
    rel: credentialLinkType,
    type: 'application/json',
    title: linkTitle,
    ...(options?.hreflang && options.hreflang.length > 0 ? { hreflang: options.hreflang } : {}),
    ...(options?.additionalRels && options.additionalRels.length > 0 ? { additionalRels: options.additionalRels } : {}),
    ...(options?.public !== undefined ? { public: options.public } : {}),
    ...(storage.encryptionAlgorithm !== undefined
      ? { encryptionMethod: toLinksetEncryptionMethod(storage.encryptionAlgorithm) }
      : {}),
    ...accessRole,
  });

  if (options?.humanVerificationUrl) {
    links.push({
      href: constructVerifyURL({
        baseUrl: options.humanVerificationUrl,
        uri: storage.uri,
        digestMultibase: storage.digestMultibase,
      }),
      rel: credentialLinkType,
      type: 'text/html',
      title: linkTitle,
      ...accessRole,
    });
  }

  return links;
}
