/**
 * Exercises the credential request schemas' refines directly, so the
 * digestMultibase 400 branch has a test that can fail. Under Jest,
 * '@uncefact/untp-utils/multibase-digest' resolves to the repo's stub
 * (moduleNameMapper; the real ESM package cannot load in this CJS suite),
 * whose fromString throws on malformed input like the real parser does, so
 * the refine's catch-and-reject path is genuinely reachable here; byte-level
 * parsing fidelity is covered by the real package's own tests in untp-utils.
 * The URL and hex checks below run against the real parsers.
 */
import { verifyCredentialRequestSchema, credentialIssueRequestSchema } from './credential';

const VALID_URI = 'https://storage.example.com/credentials/abc123';

describe('verifyCredentialRequestSchema', () => {
  it('accepts a well-formed request with a real multibase digest', () => {
    // SHA-256 multihash of the empty string, base58btc-encoded.
    const result = verifyCredentialRequestSchema.safeParse({
      uri: VALID_URI,
      digestMultibase: 'zQmdfTbBqBPQ7VNxZEYEj14VmRuZBkqFbiwReogJgS1zR1n',
      decryptionKey: 'a'.repeat(64),
    });
    expect(result.success).toBe(true);
  });

  it.each(['not-a-multibase-string', 'z', '!!!!', '0xdeadbeef'])(
    'rejects the malformed digestMultibase %j as a named issue rather than a throw',
    (value) => {
      const result = verifyCredentialRequestSchema.safeParse({ uri: VALID_URI, digestMultibase: value });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].path).toEqual(['digestMultibase']);
        expect(result.error.issues[0].message).toContain('multibase');
      }
    },
  );

  it('rejects a userinfo-bearing uri', () => {
    const result = verifyCredentialRequestSchema.safeParse({ uri: 'https://user:pass@host.example.com/x' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('userinfo');
    }
  });

  it.each([
    ['ftp://host.example.com/x', 'HTTP(S)'],
    ['not-a-url', 'valid URL'],
  ])('rejects the uri %j', (uri, fragment) => {
    const result = verifyCredentialRequestSchema.safeParse({ uri });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain(fragment);
    }
  });

  it.each(['hash', 'decryptionKey'])('rejects a non-hex %s', (field) => {
    const result = verifyCredentialRequestSchema.safeParse({ uri: VALID_URI, [field]: 'zz'.repeat(32) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual([field]);
    }
  });
});

describe('credentialIssueRequestSchema', () => {
  it('refuses the unsupported message status purpose', () => {
    // Catches a regression that expands issuance policy without an ADR-backed decision.
    const result = credentialIssueRequestSchema.safeParse({
      credentialPayload: {},
      credentialType: 'DigitalProductPassport',
      version: '0.6.1',
      statusPurposes: ['message'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'statusPurposes.0')).toBe(true);
    }
  });

  it('refuses an empty statusPurposes list because per-request no-status issuance is not offered', () => {
    // Catches a regression that exposes an untracked per-request no-status mode instead of the deployment setting.
    const result = credentialIssueRequestSchema.safeParse({
      credentialPayload: {},
      credentialType: 'DigitalProductPassport',
      version: '0.6.1',
      statusPurposes: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['statusPurposes'],
            message: 'an empty statusPurposes list is not supported; omit statusPurposes to use the deployment default',
          }),
        ]),
      );
    }
  });

  it.each([{}, [], null])('refuses a caller-supplied credentialStatus value: %p', (credentialStatus) => {
    // Catches a regression that lets the adapter silently replace caller-owned status data.
    const result = credentialIssueRequestSchema.safeParse({
      credentialPayload: { credentialStatus },
      credentialType: 'DigitalProductPassport',
      version: '0.6.1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['credentialPayload', 'credentialStatus'],
            message:
              "The reference implementation mints and manages the credential's status entries; remove credentialStatus from the payload.",
            params: { code: 'CREDENTIAL_STATUS_NOT_ACCEPTED' },
          }),
        ]),
      );
    }
  });

  it('accepts a payload without credentialStatus', () => {
    // Catches a regression that applies the refusal to the normal status-free input shape.
    const result = credentialIssueRequestSchema.safeParse({
      credentialPayload: {},
      credentialType: 'DigitalProductPassport',
      version: '0.6.1',
    });

    expect(result.success).toBe(true);
  });

  it('strips unknown keys rather than rejecting them', () => {
    const result = credentialIssueRequestSchema.safeParse({
      credentialPayload: {},
      credentialType: 'DigitalProductPassport',
      version: '0.6.1',
      unknownKey: 'ignored',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('unknownKey');
    }
  });
});
