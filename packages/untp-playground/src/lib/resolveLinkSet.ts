/**
 * Resolve an identity-resolver URL into a link set document (#811, #817).
 *
 * This is the reconciliation of the handoff's proposed `fetchArtefact.ts`: the real fetch
 * integration point is the guarded `/api/fetch` proxy, so this module only normalises the URL,
 * names the `linkset` Accept profile, and checks the response is link-set shaped. The proactive
 * `?linkType=all` normalisation is the whole flow this phase; the README's reactive retry after a
 * non-link-set response is an open decision and deliberately not implemented (#811).
 */

import { isLinkSetShaped } from '@/lib/credentialService';
import { fetchErrorMessage } from '@/lib/fetchErrorMessages';
import { API_BASE_PATH } from '../../constants';

export type ResolveLinkSetResult =
  | {
      ok: true;
      payload: Record<string, unknown>;
      /**
       * The normalised URL that was requested: the instance identity, card title source, and the
       * caption's "exact final URL requested" (#811). Redirect targets never leak into identity
       * or display (ADR-046).
       */
      requestUrl: string;
      /** The URL the response actually came from (after redirects). Unused by the UI this phase; kept for a later provenance display. */
      finalUrl: string;
    }
  | { ok: false; error: 'invalid-url' | 'fetch-failed' | 'not-json' | 'not-a-link-set'; message: string };

/**
 * Append `?linkType=all` when the URL carries no `linkType` parameter; leave a caller-supplied
 * value untouched. Throws on input that is not a parseable URL.
 */
export function normaliseResolverUrl(input: string): string {
  const url = new URL(input);
  if (!url.searchParams.has('linkType')) {
    url.searchParams.set('linkType', 'all');
  }
  // Fragments are never sent in an HTTP request, so two inputs differing only by fragment are the
  // same resolve; keeping the fragment would give them different identities for no wire difference.
  url.hash = '';
  return url.toString();
}

export async function resolveLinkSet(rawUrl: string): Promise<ResolveLinkSetResult> {
  let normalised: string;
  try {
    normalised = normaliseResolverUrl(rawUrl.trim());
  } catch (err) {
    console.error('resolveLinkSet: not a parseable URL', err);
    return { ok: false, error: 'invalid-url', message: 'That is not a valid URL.' };
  }

  let payload:
    | { ok: true; body: string; contentType: string | null; finalUrl: string }
    | { ok: false; error: string; message: string };
  try {
    const response = await fetch(`${API_BASE_PATH}/api/fetch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: normalised, accept: 'linkset' }),
    });
    payload = (await response.json()) as typeof payload;
  } catch (err) {
    console.error('resolveLinkSet: proxy fetch failed', err);
    return {
      ok: false,
      error: 'fetch-failed',
      message: 'Could not reach the resolver. Check the address and try again.',
    };
  }

  if (!payload.ok) {
    // The same user-facing copy the generic uploader shows for each proxy error code (#811 AC3).
    return { ok: false, error: 'fetch-failed', message: fetchErrorMessage(payload.error, payload.message) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.body);
  } catch (err) {
    console.error('resolveLinkSet: response body is not JSON', err);
    return { ok: false, error: 'not-json', message: 'The resolver returned content that is not valid JSON.' };
  }

  if (!isLinkSetShaped(parsed)) {
    return {
      ok: false,
      error: 'not-a-link-set',
      message: 'The resolver responded, but not with a link set (no RFC 9264 "linkset" array).',
    };
  }

  return { ok: true, payload: parsed as Record<string, unknown>, requestUrl: normalised, finalUrl: payload.finalUrl };
}
