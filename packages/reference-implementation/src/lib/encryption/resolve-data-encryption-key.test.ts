import { resolveDataEncryptionKey } from './resolve-data-encryption-key';

const DATA_KEY = 'a'.repeat(64);
const SERVICE_KEY = 'b'.repeat(64);

// Next.js augments ProcessEnv with a required NODE_ENV, so bare object
// literals need the double cast.
const asEnv = (vars: Record<string, string | undefined>): NodeJS.ProcessEnv => vars as unknown as NodeJS.ProcessEnv;

describe('resolveDataEncryptionKey', () => {
  it('returns the DATA_ENCRYPTION_KEY when only the new name is set', () => {
    const resolved = resolveDataEncryptionKey(asEnv({ DATA_ENCRYPTION_KEY: DATA_KEY }));
    expect(resolved).toEqual({ key: DATA_KEY, deprecatedName: 'absent' });
  });

  it('throws the rename instruction when only the removed SERVICE_ENCRYPTION_KEY is set', () => {
    expect(() => resolveDataEncryptionKey(asEnv({ SERVICE_ENCRYPTION_KEY: SERVICE_KEY }))).toThrow(
      'Rename it to DATA_ENCRYPTION_KEY',
    );
  });

  it('refuses to resolve when both names are set with different values, naming both remediations', () => {
    let caught: Error | undefined;
    try {
      resolveDataEncryptionKey(asEnv({ DATA_ENCRYPTION_KEY: DATA_KEY, SERVICE_ENCRYPTION_KEY: SERVICE_KEY }));
    } catch (error) {
      caught = error as Error;
    }
    expect(caught?.message).toContain('both set with different values');
    expect(caught?.message).toContain('set DATA_ENCRYPTION_KEY to that value and remove SERVICE_ENCRYPTION_KEY');
    expect(caught?.message).toContain('including after a completed rotation');
    // Never the v0.4 wording that led with "remove SERVICE_ENCRYPTION_KEY"
    // or pointed an undecided operator at rotation.
    expect(caught?.message).not.toContain('or set both to the same value');
  });

  it('flags a leftover SERVICE_ENCRYPTION_KEY as stale when it duplicates the active key', () => {
    const resolved = resolveDataEncryptionKey(
      asEnv({
        DATA_ENCRYPTION_KEY: DATA_KEY,
        SERVICE_ENCRYPTION_KEY: DATA_KEY,
      }),
    );
    expect(resolved).toEqual({ key: DATA_KEY, deprecatedName: 'stale' });
  });

  it('treats empty strings as unset', () => {
    expect(() =>
      resolveDataEncryptionKey(
        asEnv({
          DATA_ENCRYPTION_KEY: '',
          SERVICE_ENCRYPTION_KEY: SERVICE_KEY,
        }),
      ),
    ).toThrow('Rename it to DATA_ENCRYPTION_KEY');

    expect(resolveDataEncryptionKey(asEnv({ DATA_ENCRYPTION_KEY: '', SERVICE_ENCRYPTION_KEY: '' }))).toEqual({
      key: undefined,
      deprecatedName: 'absent',
    });
  });

  // A whitespace-only value has no legitimate meaning (the same rule
  // seed-preflight's normalizeEnvValue applies), so it neither supplies a
  // key nor counts as a set deprecated name.
  it('treats a whitespace-only DATA_ENCRYPTION_KEY as unset, so a set SERVICE_ENCRYPTION_KEY still throws', () => {
    expect(() =>
      resolveDataEncryptionKey(
        asEnv({
          DATA_ENCRYPTION_KEY: '   ',
          SERVICE_ENCRYPTION_KEY: SERVICE_KEY,
        }),
      ),
    ).toThrow('Rename it to DATA_ENCRYPTION_KEY');
  });

  it('treats a whitespace-only SERVICE_ENCRYPTION_KEY alone as nothing set, not as a rename failure', () => {
    expect(resolveDataEncryptionKey(asEnv({ SERVICE_ENCRYPTION_KEY: '   ' }))).toEqual({
      key: undefined,
      deprecatedName: 'absent',
    });
  });

  it('treats a whitespace-only SERVICE_ENCRYPTION_KEY as unset, not as a stale leftover', () => {
    const resolved = resolveDataEncryptionKey(
      asEnv({
        DATA_ENCRYPTION_KEY: DATA_KEY,
        SERVICE_ENCRYPTION_KEY: '   ',
      }),
    );
    expect(resolved).toEqual({ key: DATA_KEY, deprecatedName: 'absent' });
  });

  it('resolves no key and no stale flag when neither name is set', () => {
    expect(resolveDataEncryptionKey(asEnv({}))).toEqual({ key: undefined, deprecatedName: 'absent' });
  });
});
