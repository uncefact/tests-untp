import { NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const runtime = 'nodejs';

const MAX_RESPONSE_BYTES = 10 * 1_048_576;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

type FetchError = 'invalid-url' | 'blocked' | 'not-found' | 'timeout' | 'too-large' | 'too-many-redirects' | 'network';

type FetchResponse =
  | { ok: true; body: string; contentType: string | null; finalUrl: string }
  | { ok: false; error: FetchError; message: string };

export async function POST(request: Request): Promise<NextResponse<FetchResponse>> {
  let parsed: { url?: unknown };
  try {
    parsed = (await request.json()) as { url?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid-url', message: 'Request body must be JSON.' },
      { status: 400 },
    );
  }

  if (typeof parsed.url !== 'string' || parsed.url.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'invalid-url', message: 'Missing "url" string in body.' },
      { status: 400 },
    );
  }

  const result = await fetchWithGuards(parsed.url);
  return NextResponse.json(result, { status: result.ok ? 200 : statusForError(result.error) });
}

async function fetchWithGuards(initialUrl: string): Promise<FetchResponse> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const validation = await validateUrl(currentUrl);
    if (!validation.ok) return validation;

    const { url } = validation;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      // SSRF mitigations applied to `url` before reaching this point, via validateUrl above:
      //   - protocol pinned to https
      //   - hostname rejected if it matches a literal private/loopback host
      //     ('localhost', '*.localhost', '::1', '0.0.0.0')
      //   - literal IPv4 hostnames rejected if they fall in RFC1918, loopback,
      //     link-local, or "this host" ranges
      //   - literal IPv6 hostnames rejected if they fall in ::1, ::, unique-local
      //     (fc/fd), or link-local (fe80) ranges
      //   - DNS-resolved hostnames have every A/AAAA record checked against
      //     the same private-IP rules (defeats hostnames that resolve to
      //     internal addresses)
      // Redirects do not bypass these checks: redirect: 'manual' returns the
      // 3xx response to us, we resolve the Location, then validateUrl runs
      // again on the next loop iteration.
      // Residual risk: DNS rebinding between validateUrl's lookup and fetch's
      // own resolve. Mitigation would require pinning the resolved IP and
      // setting Host manually; treated as acceptable for this read-only,
      // user-initiated proxy.
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { Accept: 'application/json, application/ld+json, */*;q=0.1' },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return { ok: false, error: 'network', message: `Redirect with no Location header at ${url}.` };
        }
        currentUrl = new URL(location, url).toString();
        continue;
      }

      if (response.status === 404) {
        return { ok: false, error: 'not-found', message: `Upstream returned 404 for ${url}.` };
      }

      if (!response.ok) {
        return { ok: false, error: 'network', message: `Upstream returned ${response.status} for ${url}.` };
      }

      const contentType = response.headers.get('content-type');
      const body = await readWithLimit(response, MAX_RESPONSE_BYTES);
      if (body.kind === 'too-large') {
        return { ok: false, error: 'too-large', message: `Response exceeds ${MAX_RESPONSE_BYTES} byte limit.` };
      }
      return { ok: true, body: body.text, contentType, finalUrl: url };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, error: 'timeout', message: `Request to ${url} timed out after ${REQUEST_TIMEOUT_MS}ms.` };
      }
      return { ok: false, error: 'network', message: err instanceof Error ? err.message : 'Unknown network error.' };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, error: 'too-many-redirects', message: `Exceeded ${MAX_REDIRECTS} redirect hops.` };
}

async function validateUrl(
  input: string,
): Promise<{ ok: true; url: string } | { ok: false; error: FetchError; message: string }> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, error: 'invalid-url', message: `Not a valid URL: ${input}` };
  }

  if (url.protocol !== 'https:') {
    return { ok: false, error: 'blocked', message: `Only https: URLs are allowed (got ${url.protocol}).` };
  }

  const hostname = url.hostname;
  if (isPrivateHostname(hostname)) {
    return { ok: false, error: 'blocked', message: `Hostname ${hostname} is in a blocked range.` };
  }

  if (isIP(hostname) === 0) {
    try {
      const records = await lookup(hostname, { all: true });
      for (const record of records) {
        if (isPrivateIp(record.address)) {
          return {
            ok: false,
            error: 'blocked',
            message: `Hostname ${hostname} resolves to a private IP (${record.address}).`,
          };
        }
      }
    } catch {
      return { ok: false, error: 'network', message: `Failed to resolve ${hostname}.` };
    }
  } else if (isPrivateIp(hostname)) {
    return { ok: false, error: 'blocked', message: `Literal IP ${hostname} is in a blocked range.` };
  }

  return { ok: true, url: url.toString() };
}

function isPrivateHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return lower === 'localhost' || lower.endsWith('.localhost') || lower === '::1' || lower === '0.0.0.0';
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpv4(ip);
  if (isIP(ip) === 6) return isPrivateIpv6(ip);
  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe80')) return true;
  return false;
}

async function readWithLimit(
  response: Response,
  limit: number,
): Promise<{ kind: 'ok'; text: string } | { kind: 'too-large' }> {
  if (!response.body) return { kind: 'ok', text: '' };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  let finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    if (done) {
      finished = true;
      continue;
    }
    if (!value) continue;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return { kind: 'too-large' };
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'ok', text: new TextDecoder('utf-8').decode(merged) };
}

function statusForError(error: FetchError): number {
  switch (error) {
    case 'invalid-url':
      return 400;
    case 'blocked':
      return 400;
    case 'not-found':
      return 404;
    case 'timeout':
      return 504;
    case 'too-large':
      return 413;
    case 'too-many-redirects':
      return 502;
    case 'network':
      return 502;
  }
}
