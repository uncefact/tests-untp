/** Mint an opaque unique id for instances, runs, and undo tokens (ADR-041). */
export function newId(): string {
  const webcrypto = globalThis.crypto;
  if (webcrypto && typeof webcrypto.randomUUID === 'function') {
    return webcrypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
