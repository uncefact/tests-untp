import { getDidConfig, resetDidConfig } from './did.config';

describe('did.config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Restore a clean copy of process.env before each test
    process.env = { ...originalEnv };
    resetDidConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const validEnv = {
    SYSTEM_DID: 'did:web:example.com:org:123',
    SYSTEM_DID_KEY_ID: '7af136a8efa11a4df2e9010b972bdb92a0013724b50e5efa45407a2ddea184e6',
  };

  it('returns valid config when all env vars are set', () => {
    Object.assign(process.env, validEnv);

    const config = getDidConfig();

    expect(config).toEqual({
      defaultDid: validEnv.SYSTEM_DID,
      defaultKeyId: validEnv.SYSTEM_DID_KEY_ID,
    });
  });

  it('returns config with undefined defaultKeyId when SYSTEM_DID_KEY_ID is not set', () => {
    process.env.SYSTEM_DID = validEnv.SYSTEM_DID;
    delete process.env.SYSTEM_DID_KEY_ID;

    const config = getDidConfig();

    expect(config).toEqual({
      defaultDid: validEnv.SYSTEM_DID,
      defaultKeyId: undefined,
    });
  });

  it('throws when SYSTEM_DID is missing', () => {
    delete process.env.SYSTEM_DID;

    expect(() => getDidConfig()).toThrow('Missing required DID configuration: SYSTEM_DID');
  });

  it('includes .env guidance text in the error message', () => {
    delete process.env.SYSTEM_DID;

    expect(() => getDidConfig()).toThrow('Set this in your .env file or environment.');
  });

  it('caches config on repeated calls', () => {
    Object.assign(process.env, validEnv);

    const first = getDidConfig();

    // Mutate env after first call — cached value should still be returned
    process.env.SYSTEM_DID = 'did:web:changed.example.com';

    const second = getDidConfig();

    expect(second).toBe(first);
    expect(second.defaultDid).toBe(validEnv.SYSTEM_DID);
  });

  it('resetDidConfig() clears the cache so next call re-reads env', () => {
    Object.assign(process.env, validEnv);

    const first = getDidConfig();

    const updatedDid = 'did:web:updated.example.com';
    process.env.SYSTEM_DID = updatedDid;

    resetDidConfig();

    const second = getDidConfig();

    expect(second).not.toBe(first);
    expect(second.defaultDid).toBe(updatedDid);
  });
});
