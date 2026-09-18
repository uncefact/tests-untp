function describeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array(length ${value.length})`;
  if (typeof value !== 'object') return typeof value;
  const keys = Object.keys(value as Record<string, unknown>);
  return `object keys [${keys.join(', ') || 'none'}]`;
}

export function expectStatusListIndex(value: unknown, message: string, wire: 'stored' | 'signed'): void {
  if (wire === 'stored') {
    expect(value, message).to.be.a('string');
    expect(value, message).to.match(/^\d+$/);
    return;
  }
  expect(value, message).to.be.a('number');
  expect(Number.isInteger(value), message).to.eq(true);
}

/**
 * Unwraps a W3C enveloped verifiable credential (`EnvelopedVerifiableCredential`
 * with a `data:<media type>,<JWT>` id) to its inner credential object. A value
 * that is not an envelope is returned unchanged.
 */
export function unwrapEnvelope(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, any>;
  if (record.type !== 'EnvelopedVerifiableCredential' || typeof record.id !== 'string') return value;
  const payload = record.id.split(',')[1]?.split('.')[1];
  if (!payload) return value;
  try {
    // The Cypress browser Buffer polyfill does not know the base64url
    // encoding, so translate to standard base64 first.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Cypress.Buffer.from(base64, 'base64').toString('utf8'));
    if (decoded !== null && typeof decoded === 'object' && !Array.isArray(decoded)) {
      return decoded.vc && typeof decoded.vc === 'object' ? decoded.vc : decoded;
    }
    return decoded;
  } catch {
    return value;
  }
}

export function decodeStoredCredential(stored: unknown): Record<string, any> {
  const storedRecord = stored !== null && typeof stored === 'object' ? (stored as Record<string, unknown>) : undefined;
  const credentialValue = storedRecord?.verifiableCredential ?? stored;
  const storedShape = describeShape(stored);
  const credentialShape = describeShape(credentialValue);
  if (credentialValue === null || typeof credentialValue !== 'object' || Array.isArray(credentialValue)) {
    throw new Error(`could not decode stored copy (shape: stored ${storedShape}, credential ${credentialShape})`);
  }
  const credential = credentialValue as Record<string, any>;

  const decoded: unknown = unwrapEnvelope(credential);
  if (credential.type === 'EnvelopedVerifiableCredential' && decoded === credential) {
    throw new Error(`could not decode stored copy (shape: stored ${storedShape}, envelope ${credentialShape})`);
  }

  if (
    decoded === null ||
    typeof decoded !== 'object' ||
    Array.isArray(decoded) ||
    !Object.prototype.hasOwnProperty.call(decoded, 'credentialStatus')
  ) {
    throw new Error(
      `could not decode stored copy (shape: stored ${storedShape}, envelope ${credentialShape}, decoded ${describeShape(
        decoded,
      )}; credentialStatus missing)`,
    );
  }
  return decoded as Record<string, any>;
}
