/**
 * Detection of encrypted credential envelopes (#812). One classifier, used at credential
 * ingestion so every entry point (link set Verify, URL fetch, file upload) reports an encrypted
 * document the same way instead of walking it into the pipeline as an unclassified credential.
 * Decryption itself is later work (#813); this only names the state honestly.
 */

/** Compact JWE: five dot-separated base64url segments (RFC 7516 §3.1); only the protected header
 * must be non-empty. The header must decode to JSON carrying string `alg` and `enc`, so five
 * random segments do not classify. */
const COMPACT_JWE = /^[\w-]+\.[\w-]*\.[\w-]*\.[\w-]+\.[\w-]*$/;

function isCompactJweString(body: string): boolean {
  const trimmed = body.trim();
  if (!COMPACT_JWE.test(trimmed)) return false;
  try {
    const header = JSON.parse(atob(trimmed.split('.')[0].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof header?.alg === 'string' && typeof header?.enc === 'string';
  } catch {
    return false;
  }
}

function decodeBase64UrlJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.length === 0 || !/^[\w-]+$/.test(value)) return undefined;
  try {
    const parsed = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * RFC 7516 §3.2 JSON serialisation, checked structurally rather than by member presence: the
 * combined JOSE header (decoded `protected`, plus `unprotected`/`header` objects) must convey
 * string `alg` and `enc` (§7.2). Presence alone would misclassify a genuine credential that
 * happens to carry `ciphertext` and `header` claims.
 */
function isJsonJwe(candidate: Record<string, unknown>): boolean {
  if (typeof candidate.ciphertext !== 'string' || candidate.ciphertext.length === 0) return false;
  const headers: Record<string, unknown> = { ...decodeBase64UrlJson(candidate.protected) };
  for (const member of ['unprotected', 'header']) {
    const value = candidate[member];
    if (typeof value === 'object' && value !== null) Object.assign(headers, value);
  }
  const recipients = candidate.recipients;
  if (Array.isArray(recipients)) {
    for (const recipient of recipients) {
      const value = (recipient as { header?: unknown })?.header;
      if (typeof value === 'object' && value !== null) Object.assign(headers, value);
    }
  }
  return typeof headers.alg === 'string' && typeof headers.enc === 'string';
}

/**
 * UNTP's Decentralised Access Control page mandates "a symmetric encryption algorithm such as
 * AES with a minimum of 128 bit key length", not one variant, so classification accepts the AES
 * family at or above that key length ('aes-256-gcm', 'AES-128', ...). This is deliberately looser
 * than the services package's decryption predicate
 * (packages/services/src/encryption/is-encrypted-envelope.ts), whose algorithm enum names only
 * what that adapter can decrypt; classifying is about naming the state, not decrypting it. The
 * field encoding rules below mirror that predicate (it uses Buffer, and the Playground's adoption
 * of the shared packages is epic #824).
 */
function isPermittedEnvelopeAlgorithm(type: string): boolean {
  // Whole-token rule: 'aes', optionally a NIST key width (128/192/256, the widths AES defines),
  // then letter-led suffix segments ('gcm', 'cbc'). A stray or sub-128 number anywhere fails, so
  // 'aes-64', 'aes-999-x' and 'aes garbage' never classify.
  const match = /^aes(?:[-_]?(128|192|256))?(?:[-_]?[a-z][a-z0-9]*)*$/i.exec(type.trim());
  return match !== null;
}

// Standard base64 (the envelope contract's encoding, distinct from JOSE's base64url). A length of
// 1 mod 4 can never come from a base64 encoder, which rejects junk like 'a'/'b'/'c'.
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function isValidBase64(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length % 4 !== 1 && BASE64_PATTERN.test(value);
}

/**
 * The encrypted envelope this ecosystem's storage service writes for encrypted credentials:
 * `{ cipherText, iv, tag, type: 'aes-256-gcm', ... }`. The check follows the canonical contract:
 * a permitted algorithm in `type` and validly base64-encoded fields, so a document that merely
 * mentions the field names does not classify.
 */
function isAesGcmEnvelope(candidate: Record<string, unknown>): boolean {
  return (
    typeof candidate.type === 'string' &&
    isPermittedEnvelopeAlgorithm(candidate.type) &&
    isValidBase64(candidate.cipherText) &&
    isValidBase64(candidate.iv) &&
    isValidBase64(candidate.tag)
  );
}

/** Whether a fetched or uploaded document is an encrypted envelope rather than a credential. */
export function isEncryptedEnvelope(value: unknown): boolean {
  if (typeof value === 'string') return isCompactJweString(value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return isAesGcmEnvelope(candidate) || isJsonJwe(candidate);
}
