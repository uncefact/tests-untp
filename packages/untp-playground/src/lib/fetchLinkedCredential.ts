import { isEncryptedEnvelope } from '@/lib/encryptedEnvelope';
import { fetchErrorMessage } from '@/lib/fetchErrorMessages';
import { jwtDecode } from 'jwt-decode';
import { API_BASE_PATH } from '../../constants';

export type FetchLinkedCredentialResult = { ok: true; credential: unknown } | { ok: false; message: string };

/**
 * Compact JWS: three base64url segments, the third (signature) may be empty for an unsecured JWS
 * (RFC 7515 Appendix A.5). jwt-decode accepts that form, so the classifier must too.
 */
const COMPACT_JWS = /^[\w-]+\.[\w-]+\.[\w-]*$/;

type ProxyPayload =
  | { ok: true; body: string; contentType: string | null; finalUrl: string }
  | { ok: false; error: string; message: string };

/**
 * The proxy's response is external input to this function; a cast alone would let a malformed
 * shape (an intermediary's JSON error document, a future contract drift) crash downstream or
 * misreport as an ingestion failure. Anything outside the exact discriminated union is the
 * unexpected-response class.
 */
function parseProxyPayload(value: unknown): ProxyPayload | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if (candidate.ok === true) {
    if (
      typeof candidate.body === 'string' &&
      (typeof candidate.contentType === 'string' || candidate.contentType === null) &&
      typeof candidate.finalUrl === 'string'
    ) {
      return { ok: true, body: candidate.body, contentType: candidate.contentType, finalUrl: candidate.finalUrl };
    }
    return undefined;
  }
  if (candidate.ok === false) {
    if (typeof candidate.error === 'string' && typeof candidate.message === 'string') {
      return { ok: false, error: candidate.error, message: candidate.message };
    }
    return undefined;
  }
  return undefined;
}

/**
 * Fetches a link set's linked credential through the server-side proxy and parses the body into
 * the object the credentials pipeline ingests. Targets declare application/vc+ld+json (a JSON
 * document) or application/vc+jwt (a compact JWS string), so the body is tried as JSON first and
 * as a JWT second. Encrypted envelopes are NOT classified here: they pass through to credential
 * ingestion, whose single classifier reports them on the error surface for every entry point
 * alike (#812); a compact JWE string is passed through raw for the same reason.
 */
export async function fetchLinkedCredential(href: string): Promise<FetchLinkedCredentialResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_PATH}/api/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: href, accept: 'json' }),
    });
  } catch (err) {
    console.error('fetchLinkedCredential: proxy request failed', err);
    return { ok: false, message: 'Could not reach the credential URL. Check the link and try again.' };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (err) {
    // The proxy answered but not with JSON (e.g. an intermediary error page); that is a different
    // failure from the credential URL being unreachable, so say so.
    console.error('fetchLinkedCredential: proxy returned a non-JSON response', err);
    return { ok: false, message: 'The server returned an unexpected response. Try again shortly.' };
  }

  const payload = parseProxyPayload(raw);
  if (!payload) {
    console.error('fetchLinkedCredential: proxy response did not match its contract', raw);
    return { ok: false, message: 'The server returned an unexpected response. Try again shortly.' };
  }

  if (!payload.ok) {
    return { ok: false, message: fetchErrorMessage(payload.error, payload.message) };
  }

  const body = payload.body;
  try {
    return { ok: true, credential: JSON.parse(body) };
  } catch {
    // Not JSON; fall through to the JOSE shapes.
  }

  const trimmed = body.trim();
  if (isEncryptedEnvelope(trimmed)) {
    // A compact JWE: hand the raw string to ingestion so its encrypted classifier reports it.
    return { ok: true, credential: trimmed };
  }
  if (COMPACT_JWS.test(trimmed)) {
    try {
      return { ok: true, credential: jwtDecode(trimmed) };
    } catch (err) {
      console.error('fetchLinkedCredential: JWT decode failed', err);
      return { ok: false, message: 'The link returned a JWT that could not be decoded.' };
    }
  }

  return { ok: false, message: 'The link did not return a credential (expected JSON or a JWT).' };
}
