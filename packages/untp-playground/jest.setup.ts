import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';

// jsdom does not provide TextDecoder/TextEncoder, but jsonld -> undici depends
// on them at import time. Polyfill before any test module loads.
if (typeof globalThis.TextDecoder === 'undefined') {
  // @ts-expect-error node's TextDecoder is structurally compatible
  globalThis.TextDecoder = TextDecoder;
}
if (typeof globalThis.TextEncoder === 'undefined') {
  // @ts-expect-error node's TextEncoder is structurally compatible
  globalThis.TextEncoder = TextEncoder;
}
