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
