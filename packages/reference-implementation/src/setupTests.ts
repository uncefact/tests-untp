// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Polyfill Response for jsdom — needed for `new Response(null, { status: 204 })`
if (typeof globalThis.Response === 'undefined') {
  globalThis.Response = class Response {
    public status: number;
    public body: unknown;
    constructor(body: unknown, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
    }
    async json() {
      return JSON.parse(this.body as string);
    }
  } as unknown as typeof globalThis.Response;
}

// Polyfill AbortSignal.timeout for jsdom (available in Node >= 17.3 but not
// exposed in the jsdom environment). The runtime target is Node >= 20.12.2
// where this is always available.
if (typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('TimeoutError', 'TimeoutError')), ms);
    return controller.signal;
  };
}

// Polyfill `TextEncoder` for jsdom — the verify route encodes credential
// JSON into bytes for digest verification, and jsdom does not expose
// TextEncoder on `global` by default.
if (typeof globalThis.TextEncoder === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  globalThis.TextEncoder = require('util').TextEncoder as any;
}

// Polyfill `crypto.subtle` for jsdom — the verify route uses
// `crypto.subtle.digest('SHA-256', ...)` on the legacy-hash code path.
if (typeof globalThis.crypto === 'undefined' || typeof globalThis.crypto.subtle === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { webcrypto } = require('crypto');
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
