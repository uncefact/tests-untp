jest.mock('@/lib/prisma/generated', () => ({}));

// Tenant config mock
let mockTenantMode: 'open' | 'closed' = 'open';
jest.mock('@/lib/auth/tenant-config', () => ({
  getTenantConfig: () => {
    if (mockTenantMode === 'closed') {
      return { mode: 'closed', claimName: 'groups', claimFormat: 'array_first' };
    }
    return { mode: 'open' };
  },
}));

const mockDecodeAccessToken = jest.fn();
jest.mock('@/lib/auth/keycloak-token', () => ({
  decodeAccessToken: (token: string) => mockDecodeAccessToken(token),
}));

const mockExtractGroupClaim = jest.fn();
jest.mock('@/lib/auth/group-claim', () => ({
  extractGroupClaim: (...args: unknown[]) => mockExtractGroupClaim(...args),
}));

import { handleSignIn } from './handle-sign-in';

function buildMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    tenant: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    ...overrides,
  } as unknown as Parameters<typeof handleSignIn>[0];
}

const ACCOUNT = { providerAccountId: 'kc-12345' };

beforeEach(() => {
  jest.clearAllMocks();
  mockTenantMode = 'open';
});

// ========================================================
// Open mode tests (regression)
// ========================================================

describe('handleSignIn — open mode', () => {
  it('sets authProviderId when it is missing', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as {
      findUnique: jest.Mock;
      update: jest.Mock;
    };

    userModel.findUnique.mockResolvedValue({
      authProviderId: null,
      tenantId: 'org-1',
    });

    await handleSignIn(prisma, 'user-1', ACCOUNT, {
      name: 'Alice',
      email: 'alice@example.com',
    });

    expect(userModel.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { authProviderId: 'kc-12345' },
    });
  });

  it("creates an organisation with the user's name when tenant is missing", async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    const tenantModel = prisma.tenant as unknown as {
      create: jest.Mock;
    };

    userModel.findUnique.mockResolvedValue({
      authProviderId: 'kc-12345',
      tenantId: null,
    });
    tenantModel.create.mockResolvedValue({ id: 'new-org-1' });

    await handleSignIn(prisma, 'user-1', ACCOUNT, {
      name: 'Alice',
      email: 'alice@example.com',
    });

    expect(tenantModel.create).toHaveBeenCalledWith({
      data: { name: 'Alice Organisation' },
    });
    expect(userModel.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tenantId: 'new-org-1' },
    });
  });

  it('falls back to email for tenant name when name is absent', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    const tenantModel = prisma.tenant as unknown as {
      create: jest.Mock;
    };

    userModel.findUnique.mockResolvedValue({
      authProviderId: 'kc-12345',
      tenantId: null,
    });
    tenantModel.create.mockResolvedValue({ id: 'new-org-2' });

    await handleSignIn(prisma, 'user-2', ACCOUNT, {
      name: null,
      email: 'bob@example.com',
    });

    expect(tenantModel.create).toHaveBeenCalledWith({
      data: { name: 'bob Organisation' },
    });
  });

  it("falls back to 'My Organisation' when neither name nor email is available", async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    const tenantModel = prisma.tenant as unknown as {
      create: jest.Mock;
    };

    userModel.findUnique.mockResolvedValue({
      authProviderId: 'kc-12345',
      tenantId: null,
    });
    tenantModel.create.mockResolvedValue({ id: 'new-org-3' });

    await handleSignIn(prisma, 'user-3', ACCOUNT, {
      name: null,
      email: null,
    });

    expect(tenantModel.create).toHaveBeenCalledWith({
      data: { name: 'My Organisation' },
    });
  });

  it('is a no-op when the user is already fully onboarded', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    const tenantModel = prisma.tenant as unknown as {
      create: jest.Mock;
    };

    userModel.findUnique.mockResolvedValue({
      authProviderId: 'kc-12345',
      tenantId: 'org-1',
    });

    await handleSignIn(prisma, 'user-1', ACCOUNT, {
      name: 'Alice',
      email: 'alice@example.com',
    });

    expect(userModel.update).not.toHaveBeenCalled();
    expect(tenantModel.create).not.toHaveBeenCalled();
  });

  it('handles missing user gracefully (no-op)', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as {
      findUnique: jest.Mock;
      update: jest.Mock;
    };

    userModel.findUnique.mockResolvedValue(null);

    await handleSignIn(prisma, 'nonexistent', ACCOUNT, {
      name: 'Alice',
    });

    expect(userModel.update).not.toHaveBeenCalled();
  });

  it('sets both authProviderId and tenantId when both are missing', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    const tenantModel = prisma.tenant as unknown as {
      create: jest.Mock;
    };

    userModel.findUnique.mockResolvedValue({
      authProviderId: null,
      tenantId: null,
    });
    tenantModel.create.mockResolvedValue({ id: 'new-org-5' });

    await handleSignIn(prisma, 'user-5', ACCOUNT, {
      name: 'Dana',
      email: 'dana@example.com',
    });

    expect(userModel.update).toHaveBeenCalledWith({
      where: { id: 'user-5' },
      data: {
        authProviderId: 'kc-12345',
        tenantId: 'new-org-5',
      },
    });
  });
});

// ========================================================
// Closed mode tests
// ========================================================

describe('handleSignIn — closed mode', () => {
  beforeEach(() => {
    mockTenantMode = 'closed';
  });

  it('creates tenant with externalIdpGroupId from group claim', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as { findUnique: jest.Mock; update: jest.Mock };
    const tenantModel = prisma.tenant as unknown as { findUnique: jest.Mock; create: jest.Mock };

    mockDecodeAccessToken.mockReturnValue({ groups: ['/acme-corp'] });
    mockExtractGroupClaim.mockReturnValue('/acme-corp');

    userModel.findUnique.mockResolvedValue({ authProviderId: 'kc-12345', tenantId: null });
    tenantModel.findUnique.mockResolvedValue(null);
    tenantModel.create.mockResolvedValue({ id: 'tenant-new' });
    userModel.update.mockResolvedValue({});

    await handleSignIn(
      prisma,
      'user-1',
      { providerAccountId: 'kc-12345', access_token: 'test-token' },
      { name: 'Alice' },
    );

    expect(tenantModel.create).toHaveBeenCalledWith({
      data: { name: 'My Organisation', externalIdpGroupId: '/acme-corp' },
    });
    expect(userModel.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tenantId: 'tenant-new' },
    });
  });

  it('links user to existing tenant found by group claim', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as { findUnique: jest.Mock; update: jest.Mock };
    const tenantModel = prisma.tenant as unknown as { findUnique: jest.Mock; create: jest.Mock };

    mockDecodeAccessToken.mockReturnValue({ groups: ['/acme-corp'] });
    mockExtractGroupClaim.mockReturnValue('/acme-corp');

    userModel.findUnique.mockResolvedValue({ authProviderId: 'kc-12345', tenantId: null });
    tenantModel.findUnique.mockResolvedValue({ id: 'existing-tenant' });
    userModel.update.mockResolvedValue({});

    await handleSignIn(
      prisma,
      'user-1',
      { providerAccountId: 'kc-12345', access_token: 'test-token' },
      { name: 'Alice' },
    );

    expect(tenantModel.create).not.toHaveBeenCalled();
    expect(userModel.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tenantId: 'existing-tenant' },
    });
  });

  it('re-links user when group changes', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as { findUnique: jest.Mock; update: jest.Mock };
    const tenantModel = prisma.tenant as unknown as { findUnique: jest.Mock; create: jest.Mock };

    mockDecodeAccessToken.mockReturnValue({ groups: ['/new-group'] });
    mockExtractGroupClaim.mockReturnValue('/new-group');

    userModel.findUnique.mockResolvedValue({ authProviderId: 'kc-12345', tenantId: 'old-tenant' });
    tenantModel.findUnique.mockResolvedValue({ id: 'new-tenant' });
    userModel.update.mockResolvedValue({});

    await handleSignIn(
      prisma,
      'user-1',
      { providerAccountId: 'kc-12345', access_token: 'test-token' },
      { name: 'Alice' },
    );

    expect(userModel.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tenantId: 'new-tenant' },
    });
  });

  it('is a no-op when already linked to correct tenant', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as { findUnique: jest.Mock; update: jest.Mock };
    const tenantModel = prisma.tenant as unknown as { findUnique: jest.Mock; create: jest.Mock };

    mockDecodeAccessToken.mockReturnValue({ groups: ['/acme-corp'] });
    mockExtractGroupClaim.mockReturnValue('/acme-corp');

    userModel.findUnique.mockResolvedValue({ authProviderId: 'kc-12345', tenantId: 'correct-tenant' });
    tenantModel.findUnique.mockResolvedValue({ id: 'correct-tenant' });

    await handleSignIn(
      prisma,
      'user-1',
      { providerAccountId: 'kc-12345', access_token: 'test-token' },
      { name: 'Alice' },
    );

    expect(userModel.update).not.toHaveBeenCalled();
  });

  it('returns early when no group claim in token', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as { findUnique: jest.Mock; update: jest.Mock };

    mockDecodeAccessToken.mockReturnValue({});
    mockExtractGroupClaim.mockReturnValue(null);

    await handleSignIn(
      prisma,
      'user-1',
      { providerAccountId: 'kc-12345', access_token: 'test-token' },
      { name: 'Alice' },
    );

    expect(userModel.findUnique).not.toHaveBeenCalled();
    expect(userModel.update).not.toHaveBeenCalled();
  });

  it('returns early when no access token in account', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as { findUnique: jest.Mock; update: jest.Mock };

    await handleSignIn(prisma, 'user-1', { providerAccountId: 'kc-12345' }, { name: 'Alice' });

    expect(mockDecodeAccessToken).not.toHaveBeenCalled();
    expect(userModel.findUnique).not.toHaveBeenCalled();
  });

  it('sets authProviderId when missing during closed mode sign-in', async () => {
    const prisma = buildMockPrisma();
    const userModel = prisma.user as unknown as { findUnique: jest.Mock; update: jest.Mock };
    const tenantModel = prisma.tenant as unknown as { findUnique: jest.Mock; create: jest.Mock };

    mockDecodeAccessToken.mockReturnValue({ groups: ['/acme'] });
    mockExtractGroupClaim.mockReturnValue('/acme');

    userModel.findUnique.mockResolvedValue({ authProviderId: null, tenantId: null });
    tenantModel.findUnique.mockResolvedValue({ id: 'tenant-1' });
    userModel.update.mockResolvedValue({});

    await handleSignIn(
      prisma,
      'user-1',
      { providerAccountId: 'kc-12345', access_token: 'test-token' },
      { name: 'Alice' },
    );

    expect(userModel.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { authProviderId: 'kc-12345', tenantId: 'tenant-1' },
    });
  });
});
