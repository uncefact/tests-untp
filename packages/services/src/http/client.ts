import { CORRELATION_ID_HEADER, getOrMintCorrelationId } from '../logging/correlation-id.js';
import type { LoggerService } from '../logging/types.js';
import {
  DEFAULT_RETRY_BUDGET_MS,
  MAX_REQUEST_ATTEMPTS,
  MAX_RETRY_WAIT_MS,
  parseRetryAfter,
  retryDelayMs,
} from './retry-policy.js';
import { isRequestRetrySuppressed } from './retry-scope.js';

/**
 * How `httpFetch` may repeat a call. A `429` is retried for every call, on
 * the assumption that the dependency or its gateway refused the request
 * before acting on it (ADR-062 decision 2). A `503`, and an attempt that
 * outlived `attemptTimeoutMs`, are retried only for a call the caller marks
 * `repeatable`: one whose repetition cannot add an effect (a read or a
 * status check, whatever its HTTP method). An effectful call left unmarked
 * is never resent after a `503`, a timeout or a network error, because the
 * first attempt may already have taken effect. A network error is not
 * retried for any call.
 *
 * `deadline` is an absolute epoch-millisecond time. No wait is started that
 * would end at or after it, and no retry is dispatched once it has passed.
 * An attempt already sent is bounded by `attemptTimeoutMs` and the caller's
 * `signal`, not by the deadline, except that reading a refusal's body before
 * a wait also stops at the deadline. Without one the budget is
 * {@link DEFAULT_RETRY_BUDGET_MS} from the first attempt. The first attempt
 * is always made; the caller's `signal` is what stops it.
 */
export type HttpRetryOptions =
  | {
      repeatable: true;
      /**
       * Bounds each attempt until its response headers arrive; reading the
       * body afterwards is bounded only by the caller's `signal`, and also
       * by the deadline when the client reads a refusal's body before a
       * wait. An attempt that times out is aborted with a `DOMException`
       * named `TimeoutError` and retried if the budget allows; otherwise
       * that error is thrown.
       */
      attemptTimeoutMs?: number;
      deadline?: number;
    }
  | { repeatable?: false; deadline?: number };

/** What made an attempt worth retrying. */
export type HttpRetryCause = 429 | 503 | 'timeout';

/**
 * Why a retryable outcome was handed to the caller unretried:
 * `attempts` ({@link MAX_REQUEST_ATTEMPTS} made), `deadline`, a
 * `retry-after-too-long` or `retry-after-invalid` header, `aborted` (the
 * caller's signal fired while the refusal's body was read or during the
 * wait), `body-unreadable` (reading the refusal's body before the wait
 * failed for another reason), `suppressed` (started inside
 * `runWithoutRequestRetry` before its scope resumed retry) or
 * `body-not-replayable` (a stream request body).
 */
export type HttpRetryGiveUpReason =
  | 'attempts'
  | 'deadline'
  | 'retry-after-too-long'
  | 'retry-after-invalid'
  | 'aborted'
  | 'body-unreadable'
  | 'suppressed'
  | 'body-not-replayable';

/**
 * Reported to `onRetry`. `target` is the request URL's origin and path, with
 * no query string or credentials. `attempt` counts from 1 and names the
 * attempt whose outcome is described.
 */
export type HttpRetryEvent =
  | { type: 'retry'; target: string; method: string; attempt: number; cause: HttpRetryCause; delayMs: number }
  | {
      type: 'give-up';
      target: string;
      method: string;
      attempt: number;
      cause: HttpRetryCause;
      reason: HttpRetryGiveUpReason;
    };

export interface HttpClientOptions extends RequestInit {
  /**
   * Whether to send the request-scoped `x-correlation-id` header. Defaults to
   * true, which is correct for calls to UNTP services participating in
   * cross-service log correlation (storage, IDR, VC, DID). Pass false for
   * third-party hosts (arbitrary `did:web` domains, credential URIs, JSON-LD
   * contexts): they gain nothing from the ID, and internal request
   * identifiers should not leak to hosts outside the operator's aggregation.
   */
  correlate?: boolean;
  /**
   * Omitted: a `429` is retried. `false`: one attempt, for a call that must
   * never wait (one made while holding a lock). See {@link HttpRetryOptions}.
   */
  retry?: HttpRetryOptions | false;
  /** Told about each retry and each retryable outcome returned unretried. */
  onRetry?: (event: HttpRetryEvent) => void;
}

/**
 * One attempt's result. `detach` removes the attempt's listener from the
 * caller's signal once the client has finished with a refusal's body before
 * a wait, whether it read it in full, failed to read it or stopped at the
 * deadline: what is returned after that needs no network for the signal to
 * end. A response returned before the client has read its body keeps the
 * listener.
 */
type AttemptOutcome = { response: Response; detach: () => void } | { error: unknown; timedOut: boolean };

/**
 * The single outbound HTTP entry point for this package (#654). An ESLint
 * restriction bans bare `fetch` elsewhere under `src/`, so correlation-header
 * propagation and retry cannot be forgotten at individual call sites.
 *
 * Retries back off exponentially with full jitter (see `retry-policy.ts`)
 * and honour a `Retry-After` header as a floor on the wait after a `429` or
 * a retried `503`. A header that is neither delay-seconds nor an HTTP-date
 * ends the retry rather than resending sooner than the server asked.
 *
 * After retries end the caller sees what one attempt with the final outcome
 * would show: the last response, or the last attempt's error. That
 * response's body is unread unless the client read it before a wait, and
 * then it is the copy described below, without `content-encoding` and
 * `content-length`, or a body that fails to read if that read did not
 * finish. The caller's `signal` firing during a wait returns the response
 * that preceded the wait, whose body the client has already read in full,
 * or throws the preceding attempt's error; firing during an attempt throws
 * that attempt's error.
 *
 * For a response returned before the client has read its body, the
 * caller's signal stays wired to the body read after the headers arrive, so
 * it can still end that read, and the one listener that carries it stays on
 * the signal until the signal is collected.
 *
 * Before a wait, the refused response's body is read in full while the
 * caller's signal still applies, bounded also by the deadline. The response
 * held across the wait is rebuilt from those bytes with the same status,
 * status text and headers, less `content-encoding` and `content-length`
 * (the bytes are already decoded). It needs no network, so it reads in full
 * whenever it is returned. If that read fails, nothing waits or retries: a
 * response with the same status and status text, and the same headers less
 * those two, is returned, and its body rejects with the error that ended the
 * read (the caller's abort reason, or the network error). If the deadline
 * arrives during that read, the read is cancelled, which closes the
 * connection, and nothing waits or retries: a response with the same status,
 * status text and reduced headers is returned, and its body rejects with a
 * `DOMException` named `TimeoutError`. However that read ends, the attempt's
 * listener is then removed from the caller's signal, because what is
 * returned needs no network. The body is read through the client's own
 * reader, never a tee, so nothing is left that a later abort could reject
 * unhandled (see `readBeforeWait`).
 *
 * After a wait the signal and the deadline are checked immediately before
 * the next attempt is sent. The correlation header is identical on every
 * attempt. A `ReadableStream` body cannot be resent, so it gets one attempt.
 * A call started inside `runWithoutRequestRetry` before its scope resumes
 * retry makes one attempt. Suppression is read once, when the call starts,
 * so a call already in flight when the scope resumes keeps its one attempt.
 */
export async function httpFetch(input: string | URL, options: HttpClientOptions = {}): Promise<Response> {
  const { correlate = true, retry, onRetry, ...init } = options;
  const headers = new Headers(init.headers);

  if (correlate) {
    // The request context is authoritative: a caller-supplied header is
    // overwritten, so a stale or malformed value can never displace the
    // active request's ID, and a valid ID always reaches downstream.
    headers.set(CORRELATION_ID_HEADER, getOrMintCorrelationId());
  } else {
    // Exclusion means exclusion: strip the header even if a caller set one,
    // so internal request identifiers never reach third-party hosts.
    headers.delete(CORRELATION_ID_HEADER);
  }
  const request: RequestInit = { ...init, headers };
  if (retry === false) return fetch(input, request);
  const suppressed = isRequestRetrySuppressed();

  const signal = init.signal ?? undefined;
  const repeatable = retry?.repeatable === true;
  const attemptTimeoutMs = retry?.repeatable === true ? retry.attemptTimeoutMs : undefined;
  const deadline = retry?.deadline ?? Date.now() + DEFAULT_RETRY_BUDGET_MS;
  const target = targetOf(input);
  const method = (init.method ?? 'GET').toUpperCase();

  let outcome = await attemptOnce(input, request, signal, attemptTimeoutMs);
  for (let attempt = 1; ; attempt += 1) {
    let current = outcome;
    const cause = retryCause(current, repeatable);
    if (cause === undefined) return settle(current);

    const giveUp = (reason: HttpRetryGiveUpReason): Response => {
      onRetry?.({ type: 'give-up', target, method, attempt, cause, reason });
      return settle(current);
    };
    if (suppressed) return giveUp('suppressed');
    if (!isReplayableBody(init.body)) return giveUp('body-not-replayable');
    if (attempt >= MAX_REQUEST_ATTEMPTS) return giveUp('attempts');

    const retryAfter =
      'response' in current
        ? parseRetryAfter(current.response.headers.get('retry-after'), Date.now())
        : ({ kind: 'absent' } as const);
    if (retryAfter.kind === 'invalid') return giveUp('retry-after-invalid');
    const floorMs = retryAfter.kind === 'delay' ? retryAfter.ms : 0;
    if (floorMs > MAX_RETRY_WAIT_MS) return giveUp('retry-after-too-long');
    if (!waitFits(floorMs, deadline)) return giveUp('deadline');

    if ('response' in current) {
      const held = await readBeforeWait(current.response, deadline);
      current.detach();
      current = { response: held.response, detach: () => undefined };
      if (held.kind === 'deadline') return giveUp('deadline');
      if (held.kind === 'unreadable') return giveUp(signal?.aborted ? 'aborted' : 'body-unreadable');
    }
    // The floor is applied from the end of the read, so it is never shortened.
    if (!waitFits(floorMs, deadline)) return giveUp('deadline');
    const delayMs = Math.min(floorMs + retryDelayMs(attempt), MAX_RETRY_WAIT_MS, longestWaitBefore(deadline));

    onRetry?.({ type: 'retry', target, method, attempt, cause, delayMs });
    await sleep(delayMs, signal);
    if (signal?.aborted) return giveUp('aborted');
    if (Date.now() >= deadline) return giveUp('deadline');
    outcome = await attemptOnce(input, request, signal, attemptTimeoutMs);
  }
}

/**
 * A warn-level `onRetry` for an adapter's own logger. It logs the target,
 * method, attempt, cause and the wait or reason; never headers or bodies.
 */
export function warnOnRetry(logger: Pick<LoggerService, 'warn'>): (event: HttpRetryEvent) => void {
  return (event) => {
    if (event.type === 'retry') {
      const { target, method, attempt, cause, delayMs } = event;
      logger.warn({ target, method, attempt, cause, delayMs }, 'Outbound request refused; retrying after a wait');
    } else {
      const { target, method, attempt, cause, reason } = event;
      logger.warn({ target, method, attempt, cause, reason }, 'Outbound request refused; not retried further');
    }
  };
}

async function attemptOnce(
  input: string | URL,
  request: RequestInit,
  signal: AbortSignal | undefined,
  attemptTimeoutMs: number | undefined,
): Promise<AttemptOutcome> {
  if (signal === undefined && attemptTimeoutMs === undefined) {
    try {
      return { response: await fetch(input, request), detach: () => undefined };
    } catch (error) {
      return { error, timedOut: false };
    }
  }
  // The attempt's own controller carries the caller's abort and the attempt
  // timer. The caller's abort stays wired after the headers arrive, so it
  // still ends a body read, until the client has finished with a refusal's
  // body before a wait; the timer is cleared when the headers arrive. The
  // timer is a global setTimeout rather than AbortSignal.timeout, because
  // Jest's fake timers drive the former and not the latter.
  const attempt = new AbortController();
  const forwardAbort = (): void => attempt.abort(signal?.reason);
  const detach = (): void => signal?.removeEventListener('abort', forwardAbort);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });
  let timerFired = false;
  const handle =
    attemptTimeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timerFired = true;
          attempt.abort(new DOMException(`No response headers within ${attemptTimeoutMs} ms`, 'TimeoutError'));
        }, attemptTimeoutMs);
  try {
    return { response: await fetch(input, { ...request, signal: attempt.signal }), detach };
  } catch (error) {
    detach();
    // Retried as a timeout only when this attempt's own timer ended it; if
    // the caller's signal fired too, the caller has given up.
    return { error, timedOut: timerFired && !signal?.aborted };
  } finally {
    if (handle !== undefined) clearTimeout(handle);
  }
}

function retryCause(outcome: AttemptOutcome, repeatable: boolean): HttpRetryCause | undefined {
  if (!('response' in outcome)) return outcome.timedOut && repeatable ? 'timeout' : undefined;
  if (outcome.response.status === 429) return 429;
  if (outcome.response.status === 503 && repeatable) return 503;
  return undefined;
}

function settle(outcome: AttemptOutcome): Response {
  if ('response' in outcome) return outcome.response;
  throw outcome.error;
}

/**
 * Bodies fetch reads afresh on every send. Anything else, a stream above
 * all, may be consumed by the first attempt.
 */
function isReplayableBody(body: RequestInit['body']): boolean {
  return (
    body === undefined ||
    body === null ||
    typeof body === 'string' ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body)
  );
}

/**
 * Resolves when the wait elapses or the signal fires, whichever is first,
 * and at once for a signal that has already fired.
 */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(handle);
      resolve();
    };
    const handle = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * The longest whole-millisecond wait that ends strictly before `deadline`,
 * which may be fractional. Negative once the deadline has passed.
 */
function longestWaitBefore(deadline: number): number {
  return Math.ceil(deadline - Date.now()) - 1;
}

/**
 * Whether a wait of at least `floorMs`, and of at least 1 ms, fits before
 * `deadline`. A wait clamped below the floor would resend sooner than the
 * server asked, and one clamped to nothing is no wait at all.
 */
function waitFits(floorMs: number, deadline: number): boolean {
  return longestWaitBefore(deadline) >= Math.max(floorMs, 1);
}

type HeldForWait = { kind: 'read' | 'unreadable' | 'deadline'; response: Response };

/**
 * Reads a refused response's body in full before a retry wait, so the
 * response held across the wait needs no network. The original body is read
 * through its own reader, never a clone: a tee leaves a branch nobody reads,
 * and when the caller's signal later aborts the fetch, that branch rejects
 * with no handler and Node reports an unhandled rejection. The caller's
 * signal ends the read through the attempt it is still wired to. If the
 * deadline stops the read, the reader is cancelled, which aborts the fetch
 * and closes its connection, and the response returned has a body that
 * rejects with a `TimeoutError`.
 */
async function readBeforeWait(response: Response, deadline: number): Promise<HeldForWait> {
  if (response.body === null) return { kind: 'read', response };
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (error) {
    return { kind: 'unreadable', response: rebuild(response, erroredBody(error)) };
  }
  let handle: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'expired'>((resolve) => {
    handle = setTimeout(() => resolve('expired'), Math.max(0, deadline - Date.now()));
  });
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), expired]);
      if (next === 'expired') {
        const timeout = new DOMException("The retry deadline passed while reading the refusal's body", 'TimeoutError');
        // Cancelling runs the fetch's cancel steps, and so closes the
        // connection, before this call returns; the promise is caught
        // rather than awaited because nothing here depends on it settling.
        reader.cancel(timeout).catch(() => undefined);
        return { kind: 'deadline', response: rebuild(response, erroredBody(timeout)) };
      }
      if (next.done) break;
      chunks.push(next.value);
    }
  } catch (error) {
    return { kind: 'unreadable', response: rebuild(response, erroredBody(error)) };
  } finally {
    clearTimeout(handle);
  }
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { kind: 'read', response: rebuild(response, bytes) };
}

/**
 * A response with `response`'s status, status text and headers and the
 * given body. `content-encoding` and `content-length` are dropped because
 * they describe the bytes as sent, and these bytes are already decoded.
 */
function rebuild(response: Response, body: BodyInit): Response {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

/** A body whose every read rejects with `error`. */
function erroredBody(error: unknown): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.error(error);
    },
  });
}

function targetOf(input: string | URL): string {
  try {
    const url = new URL(input);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '<unparseable URL>';
  }
}
