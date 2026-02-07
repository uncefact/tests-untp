/**
 * DID utility functions.
 */

/**
 * Converts a did:web or did:webvh identifier to its HTTPS resolution URL.
 *
 * did:web resolves to did.json, did:webvh resolves to did.jsonl:
 *   did:web:example.com              -> https://example.com/.well-known/did.json
 *   did:web:example.com:path:to      -> https://example.com/path/to/did.json
 *   did:web:example.com%3A3000       -> https://example.com:3000/.well-known/did.json
 *   did:webvh:example.com:org:abc    -> https://example.com/org/abc/did.jsonl
 *   did:webvh:example.com            -> https://example.com/.well-known/did.jsonl
 */
export function didWebToUrl(did: string): string {
  let method: string;
  let rest: string;

  if (did.startsWith('did:webvh:')) {
    method = 'webvh';
    rest = did.slice('did:webvh:'.length);
  } else if (did.startsWith('did:web:')) {
    method = 'web';
    rest = did.slice('did:web:'.length);
  } else {
    throw new Error(`Unsupported DID method for URL conversion: ${did}`);
  }

  const filename = method === 'webvh' ? 'did.jsonl' : 'did.json';
  const parts = rest.split(':');
  const domain = decodeURIComponent(parts[0]);
  const pathParts = parts.slice(1).map(decodeURIComponent);

  if (pathParts.length === 0) {
    return `https://${domain}/.well-known/${filename}`;
  }
  return `https://${domain}/${pathParts.join('/')}/${filename}`;
}

/**
 * Parse the DID method from a DID string (e.g. "did:web:example.com" -> "web").
 *
 * Only `web` and `webvh` are supported.
 */
const SUPPORTED_METHODS = new Set(['web', 'webvh']);

export function parseDidMethod(did: string): string {
  const match = did.match(/^did:([a-z0-9]+):.+/);
  if (!match) {
    throw new Error(`Invalid DID string: ${did}`);
  }
  const method = match[1];
  if (!SUPPORTED_METHODS.has(method)) {
    throw new Error(`Unsupported DID method: ${method}`);
  }
  return method;
}

/**
 * Normalise a DID alias to a URL-safe path segment per did:web spec.
 *
 * - Lowercases the input
 * - Replaces whitespace with hyphens
 * - Strips characters that aren't lowercase alphanumeric or hyphens
 * - Collapses consecutive hyphens
 * - Trims leading/trailing hyphens
 * - Throws if the result is empty
 */
export function normaliseDidAlias(alias: string): string {
  const normalised = alias
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');

  if (!normalised) {
    throw new Error(`Invalid DID alias: "${alias}" produces an empty identifier after normalisation`);
  }

  return normalised;
}
