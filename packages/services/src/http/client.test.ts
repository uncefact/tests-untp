/**
 * @jest-environment node
 */
import { getEventListeners } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runInThisContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { httpFetch, warnOnRetry } from './client';
import { runWithoutRequestRetry } from './retry-scope';
import { runWithRequestContext } from '../logging/request-context';

/** The platform's fetch, kept before any suite replaces it with a mock. */
const platformFetch = global.fetch;

describe('httpFetch', () => {
  const mockFetch = jest.fn().mockResolvedValue({ ok: true });

  beforeEach(() => {
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  const sentHeaders = (): Headers => new Headers((mockFetch.mock.calls[0][1] as RequestInit).headers);

  it('forwards the request context correlation ID on outbound requests', async () => {
    await runWithRequestContext('ctx-42', () => httpFetch('https://storage.example.com/store'));

    expect(sentHeaders().get('x-correlation-id')).toBe('ctx-42');
  });

  it('mints a correlation ID when called outside a request context', async () => {
    await httpFetch('https://storage.example.com/store');

    expect(sentHeaders().get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('overwrites a caller-supplied correlation header with the request context ID', async () => {
    await runWithRequestContext('ctx-42', () =>
      httpFetch('https://storage.example.com/store', { headers: { 'x-correlation-id': 'stale-or-forged' } }),
    );

    expect(sentHeaders().get('x-correlation-id')).toBe('ctx-42');
  });

  it.each([
    ['a plain record', { Accept: 'application/json' } as HeadersInit],
    ['a tuple array', [['Accept', 'application/json']] as HeadersInit],
    ['a Headers instance', new Headers({ Accept: 'application/json' }) as HeadersInit],
  ])('merges the correlation header into %s', async (_shape, headers) => {
    await runWithRequestContext('ctx-42', () => httpFetch('https://storage.example.com/store', { headers }));

    expect(sentHeaders().get('accept')).toBe('application/json');
    expect(sentHeaders().get('x-correlation-id')).toBe('ctx-42');
  });

  it('preserves other request options and headers', async () => {
    await httpFetch('https://idr.example.com/links', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
      body: '{}',
    });

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://idr.example.com/links');
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{}');
    expect(sentHeaders().get('authorization')).toBe('Bearer t');
    expect(sentHeaders().get('x-correlation-id')).toBeTruthy();
  });

  it('sends no correlation header to third-party hosts when correlate is false', async () => {
    await runWithRequestContext('ctx-42', () =>
      httpFetch('https://third-party.example.com/did.json', { correlate: false }),
    );

    expect(sentHeaders().get('x-correlation-id')).toBeNull();
  });

  it('strips a caller-supplied correlation header when correlate is false', async () => {
    await httpFetch('https://third-party.example.com/did.json', {
      correlate: false,
      headers: { 'x-correlation-id': 'internal-id' },
    });

    expect(sentHeaders().get('x-correlation-id')).toBeNull();
  });
});

describe('httpFetch retry', () => {
  const URL_UNDER_TEST = 'https://vc.example.com/agent/call?token=never-logged';
  const mockFetch = jest.fn<Promise<Response>, [string | URL, RequestInit]>();
  const respond = (status: number, headers: Record<string, string> = {}): Response =>
    new Response(`body of ${status}`, { status, headers });
  /**
   * A response whose body, like real fetch's, errors when the request's
   * signal aborts before the body has been read.
   */
  const respondTo = (init: RequestInit, status: number, headers: Record<string, string> = {}): Response => {
    const signal = init.signal as AbortSignal;
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
        pull(controller) {
          controller.enqueue(new TextEncoder().encode(`body of ${status}`));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    return new Response(body, { status, headers });
  };
  /** A transport that answers only when the request's signal aborts it. */
  const hang = (_input: string | URL, init: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  const calls = (): number => mockFetch.mock.calls.length;
  /** Runs the fake clock well past any wait, so an unwanted retry is counted rather than left pending. */
  const drive = async <T>(pending: Promise<T>): Promise<T> => {
    await jest.advanceTimersByTimeAsync(60_000);
    return pending;
  };
  const events = jest.fn();

  beforeEach(() => {
    // Only the clock and timers are faked; the platform's stream and abort
    // machinery keeps its real microtask and immediate queues.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    jest.spyOn(Math, 'random').mockReturnValue(0);
    mockFetch.mockReset();
    events.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('which outcomes are retried', () => {
    it('retries a 429 on an effectful POST no sooner than its Retry-After', async () => {
      mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': '8' })).mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { method: 'POST', body: '{}', onRetry: events });
      await jest.advanceTimersByTimeAsync(7_999);
      expect(calls()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);

      expect((await pending).status).toBe(200);
      expect(calls()).toBe(2);
      expect(events).toHaveBeenCalledWith({
        type: 'retry',
        target: 'https://vc.example.com/agent/call',
        method: 'POST',
        attempt: 1,
        cause: 429,
        delayMs: 8_000,
      });
    });

    it('never resends an effectful POST after a 503', async () => {
      mockFetch.mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { method: 'POST', body: '{}', onRetry: events });
      await jest.advanceTimersByTimeAsync(10_000);
      const response = await pending;

      expect(response.status).toBe(503);
      expect(calls()).toBe(1);
      expect(events).not.toHaveBeenCalled();
    });

    it('never resends an unmarked PUT after a 503', async () => {
      mockFetch.mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { method: 'PUT', body: '{}' });
      await jest.advanceTimersByTimeAsync(10_000);
      const response = await pending;

      expect(response.status).toBe(503);
      expect(calls()).toBe(1);
    });

    it('retries a 503 on a POST marked repeatable', async () => {
      mockFetch.mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { method: 'POST', body: '{}', retry: { repeatable: true } });
      await jest.advanceTimersByTimeAsync(0);

      expect((await pending).status).toBe(200);
      expect(calls()).toBe(2);
    });

    it('honours Retry-After on a repeatable 503', async () => {
      mockFetch.mockResolvedValueOnce(respond(503, { 'Retry-After': '3' })).mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { retry: { repeatable: true } });
      await jest.advanceTimersByTimeAsync(2_999);
      expect(calls()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);

      expect((await pending).status).toBe(200);
    });

    it.each([400, 404, 500, 502, 504])('returns a %i after one attempt even when repeatable', async (status) => {
      mockFetch.mockResolvedValueOnce(respond(status)).mockResolvedValueOnce(respond(200));

      const response = await drive(httpFetch(URL_UNDER_TEST, { retry: { repeatable: true } }));

      expect(response.status).toBe(status);
      expect(calls()).toBe(1);
    });

    it('never retries a network error, even on a repeatable call', async () => {
      const failure = new TypeError('fetch failed');
      mockFetch.mockRejectedValueOnce(failure).mockResolvedValueOnce(respond(200));

      const outcome = httpFetch(URL_UNDER_TEST, { retry: { repeatable: true, attemptTimeoutMs: 1_000 } }).catch(
        (error: unknown) => error,
      );
      expect(await drive(outcome)).toBe(failure);
      expect(calls()).toBe(1);
    });

    it('makes one attempt when retry is false', async () => {
      mockFetch.mockResolvedValueOnce(respond(429)).mockResolvedValueOnce(respond(200));

      const response = await drive(httpFetch(URL_UNDER_TEST, { method: 'POST', retry: false, onRetry: events }));

      expect(response.status).toBe(429);
      expect(calls()).toBe(1);
      expect(events).not.toHaveBeenCalled();
    });

    it('stops after four attempts and returns the last response', async () => {
      mockFetch.mockImplementation(async () => respond(429));

      const pending = httpFetch(URL_UNDER_TEST, { onRetry: events });
      await jest.advanceTimersByTimeAsync(10_000);
      const response = await pending;

      expect(response.status).toBe(429);
      expect(calls()).toBe(4);
      expect(events).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: 'give-up', attempt: 4, reason: 'attempts' }),
      );
    });
  });

  describe('the wait', () => {
    it('backs off with full jitter when there is no Retry-After', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      mockFetch
        .mockResolvedValueOnce(respond(429))
        .mockResolvedValueOnce(respond(429))
        .mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { onRetry: events });
      await jest.advanceTimersByTimeAsync(249);
      expect(calls()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(calls()).toBe(2);
      // The second step is 1 000 ms, so half of it.
      await jest.advanceTimersByTimeAsync(499);
      expect(calls()).toBe(2);
      await jest.advanceTimersByTimeAsync(1);

      expect((await pending).status).toBe(200);
      expect(events.mock.calls.map(([event]) => event.delayMs)).toEqual([250, 500]);
    });

    it('waits only the jitter for Retry-After 0', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': '0' })).mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { onRetry: events });
      await jest.advanceTimersByTimeAsync(250);

      expect((await pending).status).toBe(200);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'retry', delayMs: 250 }));
    });

    it('adds the jitter to the Retry-After floor', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': '2' })).mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { onRetry: events });
      await jest.advanceTimersByTimeAsync(2_249);
      expect(calls()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);

      expect((await pending).status).toBe(200);
    });

    it('reads an HTTP-date Retry-After against the clock', async () => {
      jest.setSystemTime(Date.UTC(1994, 10, 6, 8, 49, 32));
      mockFetch
        .mockResolvedValueOnce(respond(429, { 'Retry-After': 'Sunday, 06-Nov-94 08:49:37 GMT' }))
        .mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { onRetry: events });
      await jest.advanceTimersByTimeAsync(4_999);
      expect(calls()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);

      expect((await pending).status).toBe(200);
    });

    it.each(['soon', 'Sun, 06 Nov 1994 08:49:37 PST', '1994-11-06T08:49:37Z', 'Mon, 31 Feb 2026 00:00:00 GMT'])(
      'returns the 429 after one attempt for the unusable Retry-After %s',
      async (value) => {
        mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': value })).mockResolvedValueOnce(respond(200));

        const response = await drive(httpFetch(URL_UNDER_TEST, { onRetry: events }));

        expect(response.status).toBe(429);
        expect(await response.text()).toBe('body of 429');
        expect(calls()).toBe(1);
        expect(events).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'give-up', cause: 429, reason: 'retry-after-invalid' }),
        );
      },
    );

    it('returns the response when Retry-After asks for more than 30 s', async () => {
      mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': '31' })).mockResolvedValueOnce(respond(200));

      const response = await drive(httpFetch(URL_UNDER_TEST, { onRetry: events }));

      expect(response.status).toBe(429);
      expect(calls()).toBe(1);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ reason: 'retry-after-too-long' }));
    });

    it('does not start a wait that would end after the caller deadline', async () => {
      mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': '20' })).mockResolvedValueOnce(respond(200));

      const response = await drive(
        httpFetch(URL_UNDER_TEST, { retry: { deadline: Date.now() + 10_000 }, onRetry: events }),
      );

      expect(response.status).toBe(429);
      expect(calls()).toBe(1);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ reason: 'deadline' }));
    });

    it('spends at most 30 s from the first attempt when no deadline is given', async () => {
      mockFetch.mockImplementation(async () => respond(429, { 'Retry-After': '20' }));

      const pending = httpFetch(URL_UNDER_TEST, { onRetry: events });
      await jest.advanceTimersByTimeAsync(20_000);
      const response = await pending;

      expect(response.status).toBe(429);
      expect(calls()).toBe(2);
      expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ attempt: 2, reason: 'deadline' }));
    });

    it('lets a caller deadline longer than 30 s carry more retries', async () => {
      mockFetch
        .mockResolvedValueOnce(respond(429, { 'Retry-After': '20' }))
        .mockResolvedValueOnce(respond(429, { 'Retry-After': '20' }))
        .mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { retry: { deadline: Date.now() + 120_000 } });
      await jest.advanceTimersByTimeAsync(40_000);

      expect((await pending).status).toBe(200);
      expect(calls()).toBe(3);
    });

    it('gives up when the Retry-After floor ends exactly at the deadline', async () => {
      // Fails if a floor equal to the time left is accepted: the wait would
      // be clamped below the floor and resend sooner than the server asked.
      mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': '1' })).mockResolvedValueOnce(respond(200));

      const response = await drive(
        httpFetch(URL_UNDER_TEST, { retry: { deadline: Date.now() + 1_000 }, onRetry: events }),
      );

      expect(response.status).toBe(429);
      expect(calls()).toBe(1);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'give-up', reason: 'deadline' }));
    });

    it('clamps the jitter so the wait still ends before the deadline', async () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.99);
      mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': '1' })).mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { retry: { deadline: Date.now() + 1_200 }, onRetry: events });
      await jest.advanceTimersByTimeAsync(1_199);

      expect((await pending).status).toBe(200);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'retry', delayMs: 1_199 }));
    });

    it('waits the whole Retry-After floor before a fractional deadline', async () => {
      // Fails if the clamp uses the fractional time left: 1 000.5 ms less
      // 1 gives a 999.5 ms wait, shorter than the one-second floor.
      jest.spyOn(Math, 'random').mockReturnValue(0.99);
      mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': '1' })).mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { retry: { deadline: Date.now() + 1_000.5 }, onRetry: events });
      await jest.advanceTimersByTimeAsync(999);
      expect(calls()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);

      expect((await pending).status).toBe(200);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'retry', delayMs: 1_000 }));
    });

    it('gives up when a fractional deadline leaves less than the Retry-After floor', async () => {
      mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': '1' })).mockResolvedValueOnce(respond(200));

      const response = await drive(
        httpFetch(URL_UNDER_TEST, { retry: { deadline: Date.now() + 999.5 }, onRetry: events }),
      );

      expect(response.status).toBe(429);
      expect(calls()).toBe(1);
      expect(events).toHaveBeenCalledTimes(1);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'give-up', reason: 'deadline' }));
    });

    it('gives up when reading the refusal body leaves less than the Retry-After floor before the deadline', async () => {
      // Fails if the floor is checked only before the body is read: the
      // 1 s floor fits the 1.5 s deadline at first, but after an 800 ms read
      // the wait would be clamped to 699 ms and the retry sent before the
      // server's Retry-After had passed.
      const slowBody = new ReadableStream<Uint8Array>(
        {
          pull: (controller) =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                controller.enqueue(new TextEncoder().encode('slow refusal'));
                controller.close();
                resolve();
              }, 800);
            }),
        },
        { highWaterMark: 0 },
      );
      mockFetch
        .mockResolvedValueOnce(new Response(slowBody, { status: 429, headers: { 'Retry-After': '1' } }))
        .mockResolvedValueOnce(respond(200));

      const response = await drive(
        httpFetch(URL_UNDER_TEST, { retry: { deadline: Date.now() + 1_500 }, onRetry: events }),
      );

      expect(response.status).toBe(429);
      expect(await response.text()).toBe('slow refusal');
      expect(calls()).toBe(1);
      expect(events).toHaveBeenCalledTimes(1);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'give-up', cause: 429, reason: 'deadline' }));
    });

    it('announces no wait when less than a millisecond is left before the deadline', async () => {
      // Fails if a wait is clamped to the time left: it would be announced
      // as negative, or shortened to nothing.
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      mockFetch.mockResolvedValueOnce(respond(429)).mockResolvedValueOnce(respond(200));

      const response = await drive(
        httpFetch(URL_UNDER_TEST, { retry: { deadline: Date.now() + 0.5 }, onRetry: events }),
      );

      expect(response.status).toBe(429);
      expect(calls()).toBe(1);
      expect(events).toHaveBeenCalledTimes(1);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'give-up', reason: 'deadline' }));
    });

    it('returns the earlier response unread when the deadline passed during the wait', async () => {
      mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': '1' })).mockResolvedValueOnce(respond(200));
      const deadline = Date.now() + 5_000;

      const pending = httpFetch(URL_UNDER_TEST, { retry: { deadline }, onRetry: events });
      await jest.advanceTimersByTimeAsync(0);
      // The clock jumps past the deadline without the wait's timer firing.
      jest.setSystemTime(deadline + 1);
      await jest.advanceTimersByTimeAsync(1_000);
      const response = await pending;

      expect(response.status).toBe(429);
      expect(await response.text()).toBe('body of 429');
      expect(calls()).toBe(1);
      expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'give-up', reason: 'deadline' }));
    });
  });

  describe('cancellation', () => {
    it('returns the 429 with a readable body when the signal fires during the wait', async () => {
      // Fails if the held response stays wired to the caller's signal: its
      // body then errors on the abort, as real fetch's does.
      mockFetch
        .mockImplementationOnce(async (_input, init) => respondTo(init, 429, { 'Retry-After': '5' }))
        .mockResolvedValueOnce(respond(200));
      const controller = new AbortController();

      const pending = httpFetch(URL_UNDER_TEST, { signal: controller.signal, onRetry: events });
      await jest.advanceTimersByTimeAsync(1_000);
      controller.abort();
      const response = await pending;

      expect(response.status).toBe(429);
      expect(await response.text()).toBe('body of 429');
      expect(calls()).toBe(1);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(calls()).toBe(1);
      expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'give-up', reason: 'aborted' }));
    });

    it('throws the abort of a dispatched retry without retrying it', async () => {
      mockFetch.mockResolvedValueOnce(respond(429)).mockImplementationOnce(hang).mockResolvedValueOnce(respond(200));
      const controller = new AbortController();
      const reason = new Error('caller gave up');

      const pending = httpFetch(URL_UNDER_TEST, { signal: controller.signal });
      const settled = pending.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(0);
      expect(calls()).toBe(2);
      controller.abort(reason);

      expect(await settled).toBe(reason);
      await jest.advanceTimersByTimeAsync(10_000);
      expect(calls()).toBe(2);
    });

    it('holds a copy of the refusal across the wait, not the response fetch returned', async () => {
      // Fails if the response fetch returned is held across the wait instead
      // of a copy built from its body read before the wait.
      const first = respond(429, { 'Retry-After': '1', 'X-Request-Id': 'r-1' });
      mockFetch.mockResolvedValueOnce(first).mockResolvedValueOnce(respond(200));
      const controller = new AbortController();

      const pending = httpFetch(URL_UNDER_TEST, { signal: controller.signal });
      await jest.advanceTimersByTimeAsync(500);
      controller.abort();
      const response = await pending;

      expect(response).not.toBe(first);
      expect(response.status).toBe(429);
      expect(response.headers.get('x-request-id')).toBe('r-1');
      expect(await response.text()).toBe('body of 429');
      expect(calls()).toBe(1);
    });

    it('returns the refusal unretried when its body cannot be read before the wait', async () => {
      // Fails if the loop waits and retries without the refusal's body in
      // hand: the response it would return after the wait could not be read.
      const locked = respond(429, { 'Retry-After': '1' });
      locked.body!.getReader();
      mockFetch.mockResolvedValueOnce(locked).mockResolvedValueOnce(respond(200));

      const response = await drive(httpFetch(URL_UNDER_TEST, { onRetry: events }));

      expect(response.status).toBe(429);
      expect(response.headers.get('retry-after')).toBe('1');
      await expect(response.text()).rejects.toHaveProperty('name', 'TypeError');
      expect(calls()).toBe(1);
      expect(events).toHaveBeenCalledTimes(1);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ type: 'give-up', reason: 'body-unreadable' }));
    });

    it('does not wait when the signal fired before the wait began', async () => {
      // Fails if the wait ignores a signal that is already aborted: the
      // whole Retry-After would be served after the caller gave up.
      mockFetch.mockResolvedValueOnce(respond(429, { 'Retry-After': '20' })).mockResolvedValueOnce(respond(200));
      const controller = new AbortController();
      let settled = false;

      const pending = httpFetch(URL_UNDER_TEST, {
        signal: controller.signal,
        onRetry: (event) => {
          events(event);
          if (event.type === 'retry') controller.abort();
        },
      }).finally(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(0);

      expect(settled).toBe(true);
      const response = await pending;
      expect(response.status).toBe(429);
      expect(await response.text()).toBe('body of 429');
      expect(calls()).toBe(1);
      expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'give-up', reason: 'aborted' }));
    });
  });

  describe('attempt timeout', () => {
    it('retries an attempt that outlived its own timer on a repeatable call', async () => {
      mockFetch.mockImplementationOnce(hang).mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { retry: { repeatable: true, attemptTimeoutMs: 10_000 } });
      await jest.advanceTimersByTimeAsync(9_999);
      expect(calls()).toBe(1);
      await jest.advanceTimersByTimeAsync(1);
      await jest.advanceTimersByTimeAsync(1);

      expect((await pending).status).toBe(200);
      expect(calls()).toBe(2);
    });

    it('throws a TimeoutError when every attempt times out', async () => {
      mockFetch.mockImplementation(hang);

      const pending = httpFetch(URL_UNDER_TEST, {
        retry: { repeatable: true, attemptTimeoutMs: 1_000, deadline: Date.now() + 60_000 },
        onRetry: events,
      });
      const settled = pending.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(10_000);
      const error = await settled;

      expect(error).toBeInstanceOf(DOMException);
      expect((error as DOMException).name).toBe('TimeoutError');
      expect(calls()).toBe(4);
      expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ cause: 'timeout', reason: 'attempts' }));
    });

    it('does not retry when the caller signal, not the attempt timer, ended the attempt', async () => {
      mockFetch.mockImplementationOnce(hang).mockResolvedValueOnce(respond(200));
      const controller = new AbortController();
      const reason = new Error('caller gave up');

      const pending = httpFetch(URL_UNDER_TEST, {
        signal: controller.signal,
        retry: { repeatable: true, attemptTimeoutMs: 10_000 },
      });
      const settled = pending.catch((error: unknown) => error);
      await jest.advanceTimersByTimeAsync(100);
      controller.abort(reason);

      expect(await settled).toBe(reason);
      expect(calls()).toBe(1);
    });

    it('does not retry a timed-out attempt when the caller signal fired at the same moment', async () => {
      // Fails if a timeout is retried without checking the caller's signal:
      // the caller has given up, so no retry may even be announced.
      const controller = new AbortController();
      const reason = new Error('caller gave up');
      mockFetch.mockImplementationOnce(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal as AbortSignal;
            signal.addEventListener(
              'abort',
              () => {
                // The caller gives up while the attempt timer's abort is
                // still being delivered, before fetch settles.
                controller.abort(reason);
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      );

      const outcome = httpFetch(URL_UNDER_TEST, {
        signal: controller.signal,
        retry: { repeatable: true, attemptTimeoutMs: 1_000 },
        onRetry: events,
      }).catch((error: unknown) => error);
      const error = await drive(outcome);

      expect((error as DOMException).name).toBe('TimeoutError');
      expect(calls()).toBe(1);
      expect(events).not.toHaveBeenCalled();
    });

    it('makes one attempt and throws the caller reason when the signal had already fired', async () => {
      mockFetch.mockImplementation(hang);
      const controller = new AbortController();
      const reason = new Error('caller gave up before sending');
      controller.abort(reason);

      const outcome = httpFetch(URL_UNDER_TEST, {
        signal: controller.signal,
        retry: { repeatable: true, attemptTimeoutMs: 10_000 },
      }).catch((error: unknown) => error);

      expect(await drive(outcome)).toBe(reason);
      expect(calls()).toBe(1);
    });

    it('still lets the caller signal end a body read after the headers arrived', async () => {
      mockFetch.mockImplementationOnce(
        async (_input, init) =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                (init.signal as AbortSignal).addEventListener('abort', () =>
                  controller.error((init.signal as AbortSignal).reason),
                );
              },
            }),
            { status: 200 },
          ),
      );
      const controller = new AbortController();
      const reason = new Error('caller gave up mid-body');

      const response = await httpFetch(URL_UNDER_TEST, {
        signal: controller.signal,
        retry: { repeatable: true, attemptTimeoutMs: 1_000 },
      });
      const body = response.text().catch((error: unknown) => error);
      controller.abort(reason);

      expect(await body).toBe(reason);
    });

    it('stops timing an attempt once its headers arrive', async () => {
      // Fails if the attempt timer outlives the headers: it would abort the
      // request's signal, which errors this body as it errors real fetch's.
      let streamController!: ReadableStreamDefaultController<Uint8Array>;
      mockFetch.mockImplementationOnce(async (_input, init) => {
        const signal = init.signal as AbortSignal;
        const slowBody = new ReadableStream<Uint8Array>({
          start(controller) {
            streamController = controller;
            signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
          },
        });
        return new Response(slowBody, { status: 200 });
      });

      const response = await drive(httpFetch(URL_UNDER_TEST, { retry: { repeatable: true, attemptTimeoutMs: 1_000 } }));
      const text = response.text();
      await jest.advanceTimersByTimeAsync(5_000);
      streamController.enqueue(new TextEncoder().encode('late body'));
      streamController.close();

      expect(await text).toBe('late body');
      expect(calls()).toBe(1);
    });
  });

  describe('what is resent', () => {
    it.each([
      ['a string', () => '{"a":1}'],
      ['a Blob', () => new Blob(['blob'])],
      ['FormData', () => new FormData()],
      ['URLSearchParams', () => new URLSearchParams({ a: '1' })],
      ['an ArrayBuffer', () => new ArrayBuffer(4)],
      ['a Uint8Array', () => new Uint8Array([1, 2])],
      ['no body', () => null],
    ])('resends %s', async (_label, makeBody) => {
      const body = makeBody() as BodyInit | null;
      mockFetch.mockResolvedValueOnce(respond(429)).mockResolvedValueOnce(respond(200));

      const pending = httpFetch(URL_UNDER_TEST, { method: 'POST', body });
      await jest.advanceTimersByTimeAsync(0);

      expect((await pending).status).toBe(200);
      expect(mockFetch.mock.calls[1][1].body).toBe(body);
    });

    it('makes one attempt with a ReadableStream body', async () => {
      mockFetch.mockResolvedValueOnce(respond(429)).mockResolvedValueOnce(respond(200));
      const body = new ReadableStream({
        start(controller) {
          controller.close();
        },
      });

      const response = await drive(httpFetch(URL_UNDER_TEST, { method: 'POST', body, onRetry: events }));

      expect(response.status).toBe(429);
      expect(calls()).toBe(1);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ reason: 'body-not-replayable' }));
    });

    it('sends the same correlation header on every attempt', async () => {
      mockFetch
        .mockResolvedValueOnce(respond(429))
        .mockResolvedValueOnce(respond(429))
        .mockResolvedValueOnce(respond(200));

      const pending = runWithRequestContext('ctx-retry', () => httpFetch(URL_UNDER_TEST));
      await jest.advanceTimersByTimeAsync(0);
      // A zero-delay timer set while timers are being run is given 1 ms.
      await jest.advanceTimersByTimeAsync(1);
      await pending;

      const sent = mockFetch.mock.calls.map(([, init]) => new Headers(init.headers).get('x-correlation-id'));
      expect(sent).toEqual(['ctx-retry', 'ctx-retry', 'ctx-retry']);
    });

    it('sends one minted correlation header on every attempt outside a request context', async () => {
      // Fails if an ID is minted per attempt: the attempts of one call would
      // no longer correlate in the dependency's logs.
      mockFetch
        .mockResolvedValueOnce(respond(429))
        .mockResolvedValueOnce(respond(429))
        .mockResolvedValueOnce(respond(200));

      await drive(httpFetch(URL_UNDER_TEST));

      const sent = mockFetch.mock.calls.map(([, init]) => new Headers(init.headers).get('x-correlation-id'));
      expect(sent).toHaveLength(3);
      expect(sent[0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Set(sent).size).toBe(1);
    });

    it('names an unparseable URL in its events without failing', async () => {
      mockFetch.mockResolvedValueOnce(respond(429)).mockResolvedValueOnce(respond(200));

      const pending = httpFetch('not a url', { onRetry: events });
      await jest.advanceTimersByTimeAsync(0);
      await pending;

      expect(events).toHaveBeenCalledWith(expect.objectContaining({ target: '<unparseable URL>', method: 'GET' }));
    });
  });

  describe('inside runWithoutRequestRetry', () => {
    it('makes one attempt, also under a nested request context', async () => {
      mockFetch.mockResolvedValueOnce(respond(429)).mockResolvedValueOnce(respond(200));

      const response = await drive(
        runWithoutRequestRetry(() =>
          runWithRequestContext('item-1', () => httpFetch(URL_UNDER_TEST, { method: 'POST', onRetry: events })),
        ),
      );

      expect(response.status).toBe(429);
      expect(calls()).toBe(1);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ reason: 'suppressed' }));
    });

    it('overrides a repeatable marking', async () => {
      mockFetch.mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(200));

      const response = await drive(
        runWithoutRequestRetry(() => httpFetch(URL_UNDER_TEST, { retry: { repeatable: true } })),
      );

      expect(response.status).toBe(503);
      expect(calls()).toBe(1);
    });

    it('leaves a request running concurrently outside the scope retrying', async () => {
      mockFetch.mockImplementation(async (input) =>
        String(input).includes('inside') ? respond(429) : calls() > 2 ? respond(200) : respond(429),
      );

      const inside = runWithoutRequestRetry(() => httpFetch('https://vc.example.com/inside'));
      const outside = httpFetch('https://vc.example.com/outside');
      await jest.advanceTimersByTimeAsync(0);
      const [insideResponse, outsideResponse] = await Promise.all([inside, outside]);

      expect(insideResponse.status).toBe(429);
      expect(outsideResponse.status).toBe(200);
      const urls = mockFetch.mock.calls.map(([input]) => String(input));
      expect(urls.filter((url) => url.endsWith('/inside'))).toHaveLength(1);
      expect(urls.filter((url) => url.endsWith('/outside'))).toHaveLength(2);
    });

    it('follows the ordinary rules for a call started after the scope resumes retry', async () => {
      // Regression: retry left off after a batch item dispatches, so a refused issue, store or publish is not resent.
      mockFetch
        .mockResolvedValueOnce(respond(429))
        .mockResolvedValueOnce(respond(200))
        .mockResolvedValueOnce(respond(503))
        .mockResolvedValueOnce(respond(200));

      const [afterResume, effectful503] = await drive(
        runWithoutRequestRetry(async (resumeRequestRetry) => {
          resumeRequestRetry();
          const first = await httpFetch(URL_UNDER_TEST, { method: 'POST', body: '{}' });
          const second = await httpFetch(URL_UNDER_TEST, { method: 'POST', body: '{}' });
          return [first, second];
        }),
      );

      expect(afterResume.status).toBe(200);
      expect(effectful503.status).toBe(503);
      expect(calls()).toBe(3);
    });

    it('keeps one attempt for a call already in flight when the scope resumes retry', async () => {
      // Regression: suppression read at the retry decision, so a request made before dispatch is resent because dispatch fired while it was in flight.
      let answer!: (response: Response) => void;
      mockFetch
        .mockImplementationOnce(
          () =>
            new Promise<Response>((resolve) => {
              answer = resolve;
            }),
        )
        .mockResolvedValueOnce(respond(200));

      const response = await drive(
        runWithoutRequestRetry(async (resumeRequestRetry) => {
          const pending = httpFetch(URL_UNDER_TEST, { method: 'POST', body: '{}', onRetry: events });
          await Promise.resolve();
          resumeRequestRetry();
          answer(respond(429));
          return pending;
        }),
      );

      expect(response.status).toBe(429);
      expect(calls()).toBe(1);
      expect(events).toHaveBeenCalledWith(expect.objectContaining({ reason: 'suppressed' }));
    });
  });
});

describe('httpFetch retry over a real HTTP connection', () => {
  const STALLED_PREFIX = 'partial refusal ';
  let server: Server;
  let origin: string;
  /** Paths whose server-side response has closed, in order. */
  let closed: string[];
  /** Paths the server has received a request for, in order. */
  let received: string[];

  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      received.push(url.pathname);
      response.on('close', () => closed.push(url.pathname));
      if (url.pathname === '/limited') {
        const body = gzipSync('slow down');
        response.writeHead(429, {
          'Retry-After': '2',
          'Content-Type': 'text/plain',
          'Content-Encoding': 'gzip',
          'Content-Length': String(body.byteLength),
          Connection: 'close',
        });
        response.end(body);
        return;
      }
      if (url.pathname === '/slow-limited') {
        // A 429 whose body takes 800 ms to finish.
        response.writeHead(429, { 'Retry-After': '1', 'Content-Type': 'text/plain' });
        response.write('slow ');
        setTimeout(() => response.end('refusal'), 800);
        return;
      }
      // A 503 that sends its headers and the start of a body, then never
      // finishes it.
      const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
      const retryAfter = url.searchParams.get('retry-after');
      if (retryAfter !== null) headers['Retry-After'] = retryAfter;
      response.writeHead(503, headers);
      response.write(STALLED_PREFIX);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    global.fetch = platformFetch;
    closed = [];
    received = [];
  });

  /** What a promise has done after `ms`: settled, or still pending. */
  const within = async <T>(
    promise: Promise<T>,
    ms: number,
  ): Promise<{ resolved: T } | { rejected: unknown } | 'pending'> => {
    let handle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'pending'>((resolve) => {
      handle = setTimeout(() => resolve('pending'), ms);
    });
    try {
      return await Promise.race([
        promise.then(
          (resolved) => ({ resolved }),
          (rejected: unknown) => ({ rejected }),
        ),
        timeout,
      ]);
    } finally {
      clearTimeout(handle);
    }
  };

  /** Resolves once the server has seen the response for `path` close. */
  const serverClosed = async (path: string): Promise<boolean> => {
    for (let waited = 0; waited < 2_000; waited += 20) {
      if (closed.includes(path)) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  };

  it('returns a 429 whose body is still readable when the caller gives up during the wait', async () => {
    // Fails if the response held across the wait still needs the network or
    // the caller's signal: the caller could not read the refusal it was
    // handed. Fails too if the copy keeps the encoding and length of the
    // compressed bytes the server sent while holding the decoded text.
    const controller = new AbortController();

    const response = await httpFetch(`${origin}/limited`, {
      signal: controller.signal,
      correlate: false,
      onRetry: (event) => {
        if (event.type === 'retry') setTimeout(() => controller.abort(), 50);
      },
    });

    expect(controller.signal.aborted).toBe(true);
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('2');
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-length')).toBeNull();
    expect(await response.text()).toBe('slow down');
  });

  it('settles when the caller gives up while an unfinished refusal body is being read', async () => {
    // Fails if the refusal is held across the wait before its body has been
    // read: the caller's signal is detached from it, so after the caller
    // gives up its body read never ends.
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    const events: unknown[] = [];
    setTimeout(() => controller.abort(reason), 200);

    const response = await httpFetch(`${origin}/stalled-a?retry-after=2`, {
      signal: controller.signal,
      correlate: false,
      retry: { repeatable: true },
      onRetry: (event) => events.push(event),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('2');
    expect(await within(response.text(), 1_000)).toEqual({ rejected: reason });
    expect(events).toEqual([expect.objectContaining({ type: 'give-up', cause: 503, reason: 'aborted' })]);
    expect(await serverClosed('/stalled-a')).toBe(true);
    expect(closed).toEqual(['/stalled-a']);
  });

  it('returns a refusal read before the wait that needs no connection when the caller gives up during the wait', async () => {
    const controller = new AbortController();

    const response = await httpFetch(`${origin}/limited`, {
      signal: controller.signal,
      correlate: false,
      onRetry: (event) => {
        if (event.type === 'retry') setTimeout(() => controller.abort(), 50);
      },
    });
    server.closeAllConnections();

    expect(response.status).toBe(429);
    expect(await within(response.text(), 1_000)).toEqual({ resolved: 'slow down' });
  });

  /**
   * Runs `scenario`, waits `settleMs` more, and returns the unhandled
   * rejections Node reported meanwhile. Jest's node environment hands each
   * test file a copy of `process`, so a listener added through it never hears
   * Node's event; `runInThisContext` reaches the real process outside the
   * test's context. Jest's own listener there, which would report the
   * rejection as an error of the running test, is set aside for the window
   * and always restored, so the test fails on its own assertion.
   */
  const unhandledRejectionsDuring = async (scenario: () => Promise<void>, settleMs = 500): Promise<string[]> => {
    const realProcess = runInThisContext('process') as NodeJS.Process;
    const jestListeners = realProcess.listeners('unhandledRejection');
    const seen: string[] = [];
    const record = (reason: unknown): void => {
      seen.push(reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason));
    };
    realProcess.removeAllListeners('unhandledRejection');
    realProcess.on('unhandledRejection', record);
    try {
      await scenario();
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    } finally {
      realProcess.removeListener('unhandledRejection', record);
      for (const listener of jestListeners) realProcess.on('unhandledRejection', listener);
    }
    return seen;
  };

  const deadlineTimeout = expect.objectContaining({
    name: 'TimeoutError',
    message: expect.stringContaining('retry deadline passed'),
  });

  it('leaves nothing to reject when the caller aborts after the deadline ended an unfinished refusal body', async () => {
    // Fails if the read before the wait reads a clone: the deadline cancels
    // only the copy, and the caller's later abort rejects the unread
    // original branch with no handler, which Node reports and which kills
    // a worker or an operator command.
    const controller = new AbortController();
    const events: unknown[] = [];
    let response: Response | undefined;

    const unhandled = await unhandledRejectionsDuring(async () => {
      response = await httpFetch(`${origin}/stalled-deadline-a`, {
        signal: controller.signal,
        correlate: false,
        retry: { repeatable: true, deadline: Date.now() + 300 },
        onRetry: (event) => events.push(event),
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      controller.abort(new DOMException('the caller has settled', 'AbortError'));
    });

    expect(unhandled).toEqual([]);
    expect(received).toEqual(['/stalled-deadline-a']);
    expect(events).toEqual([expect.objectContaining({ type: 'give-up', cause: 503, reason: 'deadline' })]);
    expect(response!.status).toBe(503);
    expect(await within(response!.text(), 1_000)).toEqual({ rejected: deadlineTimeout });
  });

  it('leaves nothing to reject when the caller reads the body after aborting, once the deadline ended the read', async () => {
    // Fails if the response returned at the deadline is still tied to the
    // caller's signal or to the connection: the read would reject with the
    // caller's abort, or hang, instead of the deadline's TimeoutError.
    const controller = new AbortController();
    let read: Awaited<ReturnType<typeof within>> | undefined;

    const unhandled = await unhandledRejectionsDuring(async () => {
      const response = await httpFetch(`${origin}/stalled-deadline-b`, {
        signal: controller.signal,
        correlate: false,
        retry: { repeatable: true, deadline: Date.now() + 300 },
      });
      controller.abort(new DOMException('the caller has settled', 'AbortError'));
      read = await within(response.text(), 1_000);
    });

    expect(unhandled).toEqual([]);
    expect(read).toEqual({ rejected: deadlineTimeout });
    expect(received).toEqual(['/stalled-deadline-b']);
  });

  it('closes the connection of an unfinished refusal body at the deadline when the caller passed no signal', async () => {
    // Fails if the read before the wait is bounded only by the caller's
    // signal (with none, the call never settles), or if the deadline leaves
    // the connection open for a body nobody will read.
    const events: unknown[] = [];
    const started = Date.now();
    let response: Response | undefined;

    const unhandled = await unhandledRejectionsDuring(async () => {
      response = await httpFetch(`${origin}/stalled-c`, {
        correlate: false,
        retry: { repeatable: true, deadline: Date.now() + 500 },
        onRetry: (event) => events.push(event),
      });
    });

    expect(unhandled).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(events).toEqual([expect.objectContaining({ type: 'give-up', cause: 503, reason: 'deadline' })]);
    expect(await serverClosed('/stalled-c')).toBe(true);
    expect(received).toEqual(['/stalled-c']);
    expect(response!.status).toBe(503);
    expect(await within(response!.text(), 1_000)).toEqual({ rejected: deadlineTimeout });
  });

  it('leaves nothing to reject when the caller aborts after a refusal returned unread without a wait', async () => {
    // On this path the original response is returned as one attempt
    // returns it, still wired to the caller's signal by design. Fails if
    // the client tees or otherwise holds a second reader on that body.
    const controller = new AbortController();
    const reason = new DOMException('the caller has settled', 'AbortError');
    const events: unknown[] = [];
    let response: Response | undefined;

    const unhandled = await unhandledRejectionsDuring(async () => {
      response = await httpFetch(`${origin}/stalled-d?retry-after=60`, {
        signal: controller.signal,
        correlate: false,
        retry: { repeatable: true },
        onRetry: (event) => events.push(event),
      });
      controller.abort(reason);
    });

    expect(unhandled).toEqual([]);
    expect(received).toEqual(['/stalled-d']);
    expect(events).toEqual([expect.objectContaining({ type: 'give-up', cause: 503, reason: 'retry-after-too-long' })]);
    expect(await within(response!.text(), 1_000)).toEqual({ rejected: reason });
  });

  it('leaves no listener on the caller signal once the deadline ended the read of a refusal body', async () => {
    // Fails if the attempt's listener stays on the caller's signal after
    // the client has read a refusal's body before a wait: a long-lived
    // signal, such as a job's, would keep that listener although the
    // response it was returned needs no network.
    const controller = new AbortController();
    const events: unknown[] = [];

    const response = await httpFetch(`${origin}/stalled-listener`, {
      signal: controller.signal,
      correlate: false,
      retry: { repeatable: true, deadline: Date.now() + 300 },
      onRetry: (event) => events.push(event),
    });

    expect(events).toEqual([expect.objectContaining({ type: 'give-up', cause: 503, reason: 'deadline' })]);
    expect(response.status).toBe(503);
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });

  it('leaves no listener on the caller signal once it read a refusal body in full and did not retry', async () => {
    // Fails for the same reason as the deadline case above. The 1 s
    // Retry-After fits the 1.5 s deadline before the 800 ms read and not
    // after it, so the client gives up holding the copy it read.
    const controller = new AbortController();
    const events: unknown[] = [];

    const response = await httpFetch(`${origin}/slow-limited`, {
      signal: controller.signal,
      correlate: false,
      retry: { deadline: Date.now() + 1_500 },
      onRetry: (event) => events.push(event),
    });

    expect(events).toEqual([expect.objectContaining({ type: 'give-up', cause: 429, reason: 'deadline' })]);
    expect(received).toEqual(['/slow-limited']);
    expect(await response.text()).toBe('slow refusal');
    expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
  });
});

describe('warnOnRetry', () => {
  it('logs a retry and a give-up at warn without headers or bodies', () => {
    const logger = { warn: jest.fn() };
    const log = warnOnRetry(logger);

    log({ type: 'retry', target: 'https://idr.example.com/x', method: 'GET', attempt: 1, cause: 503, delayMs: 250 });
    log({
      type: 'give-up',
      target: 'https://idr.example.com/x',
      method: 'GET',
      attempt: 4,
      cause: 429,
      reason: 'attempts',
    });

    expect(logger.warn).toHaveBeenNthCalledWith(
      1,
      { target: 'https://idr.example.com/x', method: 'GET', attempt: 1, cause: 503, delayMs: 250 },
      'Outbound request refused; retrying after a wait',
    );
    expect(logger.warn).toHaveBeenNthCalledWith(
      2,
      { target: 'https://idr.example.com/x', method: 'GET', attempt: 4, cause: 429, reason: 'attempts' },
      'Outbound request refused; not retried further',
    );
  });
});
