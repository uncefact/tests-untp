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

  it('falls back to the deprecated SERVICE_ENCRYPTION_KEY and flags it as the source', () => {
    const resolved = resolveDataEncryptionKey(asEnv({ SERVICE_ENCRYPTION_KEY: SERVICE_KEY }));
    expect(resolved).toEqual({ key: SERVICE_KEY, deprecatedName: 'source' });
  });

  it('accepts both names set to the same value, flagging the duplication', () => {
    const resolved = resolveDataEncryptionKey(
      asEnv({
        DATA_ENCRYPTION_KEY: DATA_KEY,
        SERVICE_ENCRYPTION_KEY: DATA_KEY,
      }),
    );
    expect(resolved).toEqual({ key: DATA_KEY, deprecatedName: 'duplicate' });
  });

  it('throws when both names are set with different values', () => {
    expect(() =>
      resolveDataEncryptionKey(
        asEnv({
          DATA_ENCRYPTION_KEY: DATA_KEY,
          SERVICE_ENCRYPTION_KEY: SERVICE_KEY,
        }),
      ),
    ).toThrow('both set with different values');
  });

  it('treats empty strings as unset', () => {
    const resolved = resolveDataEncryptionKey(
      asEnv({
        DATA_ENCRYPTION_KEY: '',
        SERVICE_ENCRYPTION_KEY: SERVICE_KEY,
      }),
    );
    expect(resolved.key).toBe(SERVICE_KEY);
    expect(resolved.deprecatedName).toBe('source');

    expect(resolveDataEncryptionKey(asEnv({ DATA_ENCRYPTION_KEY: '', SERVICE_ENCRYPTION_KEY: '' }))).toEqual({
      key: undefined,
      deprecatedName: 'absent',
    });
  });
});
