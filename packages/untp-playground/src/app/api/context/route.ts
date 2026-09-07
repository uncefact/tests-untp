import { createInMemoryTtlCache } from '@uncefact/untp-utils/cache';
import { createJsonLdDocumentLoader, type LoadedRemoteDocument } from '@uncefact/untp-utils/loaders';
import {
  describeJsonLdFailure,
  expandJsonLd,
  JsonLdValidationError,
  type JsonLdFailureDescription,
} from '@uncefact/untp-utils/validation';
import { NextResponse } from 'next/server';

// The guarded document loader resolves DNS and pins connections through
// undici, which needs the Node runtime (as `/api/fetch` does).
export const runtime = 'nodejs';

const CONTEXT_CACHE_TTL_MS = 60 * 60 * 1000;
// Context URLs come from the caller's document, so the key space is
// unbounded; the entry cap is what bounds the cache.
const CONTEXT_CACHE_MAX_ENTRIES = 200;

/**
 * `request` (400): the body was not a JSON object carrying `document`.
 * `service` (500): the service itself failed before or after expansion; the
 * document was not judged. Everything else (422) is the classifier's
 * description of why the document or its contexts could not be expanded.
 */
export interface ContextServiceFailure {
  kind: 'request' | 'service';
  detail: string;
}

export type ContextFailure = JsonLdFailureDescription | ContextServiceFailure;

/**
 * 200 carries the expanded form. Every failure carries the description's
 * detail as `error` (the repo's `{ error, code? }` convention, as
 * `/api/schema` answers) and the whole description as `failure`, so the
 * browser can map its kind and fields onto the verifier's copy.
 */
export type ContextResponse = { expanded: unknown[] } | { error: string; failure: ContextFailure };

const failureResponse = (failure: ContextFailure, status: number): NextResponse<ContextResponse> =>
  NextResponse.json({ error: failure.detail, failure }, { status });

const codeOf = (value: unknown): string | undefined =>
  typeof value === 'object' && value !== null && typeof (value as { code?: unknown }).code === 'string'
    ? (value as { code: string }).code
    : undefined;

// The first structured code on a cause chain: jsonld.js's own wrapper carries
// none, the guard's or resolver's typed error beneath it does.
function firstCodeOnChain(error: unknown): string | undefined {
  for (let node = error, depth = 0; node !== undefined && depth < 8; depth += 1) {
    const code = codeOf(node);
    if (code) return code;
    node = node instanceof Error ? node.cause : undefined;
  }
  return undefined;
}

// One loader per server process: its TTL cache dedups concurrent fetches of
// the same context and serves repeat expansions without a network round trip.
const documentLoader = createJsonLdDocumentLoader({
  // Contexts are fetched over TLS only, as `/api/schema` requires of schemas:
  // a context fetched in the clear can be altered on the path, which changes
  // how the credential expands.
  allowedSchemes: ['https'],
  cache: createInMemoryTtlCache<LoadedRemoteDocument>({
    ttlMs: CONTEXT_CACHE_TTL_MS,
    maxEntries: CONTEXT_CACHE_MAX_ENTRIES,
  }),
  onBundledFallback: ({ url, cause }) => {
    console.warn('Served the bundled copy of a JSON-LD context because its fetch failed', {
      url,
      code: codeOf(cause),
      causeCode: codeOf((cause as { cause?: unknown })?.cause),
    });
  },
});

export async function POST(request: Request): Promise<NextResponse<ContextResponse>> {
  let body: { document?: unknown };
  try {
    body = (await request.json()) as { document?: unknown };
  } catch {
    return failureResponse({ kind: 'request', detail: 'Request body must be JSON.' }, 400);
  }
  const document = body?.document;
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return failureResponse({ kind: 'request', detail: 'Body must carry a JSON object as "document".' }, 400);
  }

  let expanded: unknown[];
  try {
    // expandJsonLd runs jsonld in safe mode through the shared guarded loader,
    // with the bundled UNTP contexts standing in when a host is down.
    expanded = await expandJsonLd(document, { documentLoader });
  } catch (error) {
    if (error instanceof JsonLdValidationError) {
      // 422: the document was received and processed; it or its contexts are
      // what failed. describeJsonLdFailure is the one place that decides what
      // of the failure is safe to hand back, so the browser gets its
      // description and nothing else. The typed cause goes to the server log,
      // where an SSRF refusal is greppable apart from an outage.
      const failure = describeJsonLdFailure(error);
      const cause = error.cause;
      console.warn('JSON-LD expansion failed', {
        kind: failure.kind,
        url: 'url' in failure ? failure.url : undefined,
        code: firstCodeOnChain(cause),
        cause,
      });
      return failureResponse(failure, 422);
    }
    // Anything else is the service's own failure, never the document's, so
    // it must not be reported as a document fault.
    console.error('JSON-LD expansion failed inside the context service', error);
    return failureResponse(
      { kind: 'service', detail: 'The context service hit an internal error. Retry in a moment.' },
      500,
    );
  }
  return NextResponse.json({ expanded });
}
