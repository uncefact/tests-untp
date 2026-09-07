import { createInMemoryTtlCache } from '@uncefact/untp-utils/cache';
import { createJsonLdDocumentLoader, type LoadedRemoteDocument } from '@uncefact/untp-utils/loaders';
import { describeJsonLdFailure, expandJsonLd, type JsonLdFailureDescription } from '@uncefact/untp-utils/validation';
import { NextResponse } from 'next/server';

// The guarded document loader resolves DNS and pins connections through
// undici, which needs the Node runtime (as `/api/fetch` does).
export const runtime = 'nodejs';

const CONTEXT_CACHE_TTL_MS = 60 * 60 * 1000;
// Context URLs come from the caller's document, so the cache is bounded.
const CONTEXT_CACHE_MAX_ENTRIES = 200;

export type ContextResponse =
  | { ok: true; expanded: unknown }
  | { ok: false; error: JsonLdFailureDescription | { kind: 'request'; detail: string } };

const codeOf = (value: unknown): string | undefined =>
  typeof value === 'object' && value !== null && typeof (value as { code?: unknown }).code === 'string'
    ? (value as { code: string }).code
    : undefined;

// One loader per server process: its TTL cache dedups concurrent fetches of
// the same context and serves repeat expansions without a network round trip.
const documentLoader = createJsonLdDocumentLoader({
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
    return NextResponse.json(
      { ok: false, error: { kind: 'request', detail: 'Request body must be JSON.' } },
      { status: 400 },
    );
  }
  const document = body?.document;
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return NextResponse.json(
      { ok: false, error: { kind: 'request', detail: 'Body must carry a JSON object as "document".' } },
      { status: 400 },
    );
  }

  try {
    // expandJsonLd runs jsonld in safe mode through the shared guarded loader,
    // with the bundled UNTP contexts standing in when a host is down.
    const expanded = await expandJsonLd(document, { documentLoader });
    return NextResponse.json({ ok: true, expanded });
  } catch (error) {
    // 422: the document was received and processed; it or its contexts are
    // what failed. describeJsonLdFailure is the one place that decides what
    // of the failure is safe to hand back, so the browser gets its
    // description and nothing else.
    return NextResponse.json({ ok: false, error: describeJsonLdFailure(error) }, { status: 422 });
  }
}
