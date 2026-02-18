describe('getTenantConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults to open mode when TENANT_MODE is not set', () => {
    delete process.env.TENANT_MODE;
    const { getTenantConfig } = require('./tenant-config');
    const config = getTenantConfig();
    expect(config.mode).toBe('open');
  });

  it('returns open config when TENANT_MODE=open', () => {
    process.env.TENANT_MODE = 'open';
    const { getTenantConfig } = require('./tenant-config');
    const config = getTenantConfig();
    expect(config.mode).toBe('open');
  });

  it('returns closed config with defaults when TENANT_MODE=closed', () => {
    process.env.TENANT_MODE = 'closed';
    const { getTenantConfig } = require('./tenant-config');
    const config = getTenantConfig();
    expect(config).toEqual({
      mode: 'closed',
      claimName: 'groups',
      claimFormat: 'array_first',
    });
  });

  it('reads custom claim name and format in closed mode', () => {
    process.env.TENANT_MODE = 'closed';
    process.env.TENANT_CLAIM_NAME = 'urn:zitadel:iam:user:resourceowner:id';
    process.env.TENANT_CLAIM_FORMAT = 'string';
    const { getTenantConfig } = require('./tenant-config');
    const config = getTenantConfig();
    expect(config.claimName).toBe('urn:zitadel:iam:user:resourceowner:id');
    expect(config.claimFormat).toBe('string');
  });

  it('throws on invalid TENANT_MODE value', () => {
    process.env.TENANT_MODE = 'hybrid';
    const { getTenantConfig } = require('./tenant-config');
    expect(() => getTenantConfig()).toThrow(/Invalid TENANT_MODE/);
  });

  it('throws on invalid TENANT_CLAIM_FORMAT value', () => {
    process.env.TENANT_MODE = 'closed';
    process.env.TENANT_CLAIM_FORMAT = 'nested_object';
    const { getTenantConfig } = require('./tenant-config');
    expect(() => getTenantConfig()).toThrow(/Invalid TENANT_CLAIM_FORMAT/);
  });
});
