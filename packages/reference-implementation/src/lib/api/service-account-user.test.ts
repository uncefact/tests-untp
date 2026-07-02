// Mock logging BEFORE any imports that depend on it
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock('@uncefact/untp-ri-services/logging', () => ({
  createLogger: () => ({ child: () => mockLogger }),
}));

// Mock Prisma - use inline object to avoid hoisting issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma: any = {
  user: { findUnique: jest.fn(), create: jest.fn() },
  tenant: { create: jest.fn() },
  $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma)),
};
jest.mock('@/lib/prisma/prisma', () => ({ prisma: mockPrisma }));

import { resolveServiceAccountUser, ServiceAccountClaims } from './service-account-user';

beforeEach(() => {
  jest.resetAllMocks();
  // Re-assign the default $transaction behaviour after resetAllMocks clears it
  mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma));
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CLAIMS: ServiceAccountClaims = {
  sub: 'sa-abc-123',
  name: 'John',
  email: 'john@example.com',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveServiceAccountUser', () => {
  // 1. Happy path: user exists with tenantId
  it('returns userId and tenantId when user exists with a tenant', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1' });

    const result = await resolveServiceAccountUser(CLAIMS);

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { authProviderId: 'sa-abc-123' },
      select: { id: true, tenantId: true },
    });
    expect(result).toEqual({ userId: 'user-1', tenantId: 'tenant-1' });
    expect(mockLogger.debug).toHaveBeenCalledWith(
      { sub: 'sa-abc-123', userId: 'user-1', tenantId: 'tenant-1' },
      'User resolved from authProviderId',
    );
  });

  // 2. User exists without tenantId — unexpected state
  it('returns null and logs error when user exists without a tenant', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', tenantId: null });

    const result = await resolveServiceAccountUser(CLAIMS);

    expect(result).toBeNull();
    expect(mockLogger.error).toHaveBeenCalledWith(
      { sub: 'sa-abc-123', userId: 'user-1' },
      'User exists without tenant — unexpected state',
    );
  });

  // 3. Provisioning path: user does not exist — creates User + Tenant
  it('auto-provisions a new user and tenant when user is not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.tenant.create.mockResolvedValue({ id: 'tenant-new' });
    mockPrisma.user.create.mockResolvedValue({ id: 'user-new' });

    const result = await resolveServiceAccountUser(CLAIMS);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'John Organisation' },
    });
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        authProviderId: 'sa-abc-123',
        name: 'John',
        email: 'john@example.com',
        tenantId: 'tenant-new',
      },
    });
    expect(result).toEqual({ userId: 'user-new', tenantId: 'tenant-new' });
    expect(mockLogger.info).toHaveBeenCalledWith(
      { sub: 'sa-abc-123', userId: 'user-new', tenantId: 'tenant-new' },
      'New user auto-provisioned',
    );
  });

  // 4. Provisioning with name — uses name for tenant name
  it('uses claims.name for tenant name when available', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.tenant.create.mockResolvedValue({ id: 'tenant-new' });
    mockPrisma.user.create.mockResolvedValue({ id: 'user-new' });

    await resolveServiceAccountUser({ sub: 'sa-1', name: 'Alice' });

    expect(mockPrisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'Alice Organisation' },
    });
  });

  // 5. Provisioning with email only — uses email prefix
  it('uses email prefix for tenant name when name is not provided', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.tenant.create.mockResolvedValue({ id: 'tenant-new' });
    mockPrisma.user.create.mockResolvedValue({ id: 'user-new' });

    await resolveServiceAccountUser({ sub: 'sa-2', email: 'john@example.com' });

    expect(mockPrisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'john Organisation' },
    });
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        authProviderId: 'sa-2',
        name: null,
        email: 'john@example.com',
        tenantId: 'tenant-new',
      },
    });
  });

  // 6. Provisioning with no name or email — uses "My Organisation"
  it('uses "My Organisation" when neither name nor email is provided', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.tenant.create.mockResolvedValue({ id: 'tenant-new' });
    mockPrisma.user.create.mockResolvedValue({ id: 'user-new' });

    await resolveServiceAccountUser({ sub: 'sa-3' });

    expect(mockPrisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'My Organisation' },
    });
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        authProviderId: 'sa-3',
        name: null,
        email: null,
        tenantId: 'tenant-new',
      },
    });
  });

  // 7. Conflict/retry path: P2002 then retry finds user
  it('retries lookup on unique constraint violation and returns the existing user', async () => {
    // First findUnique: user not found → enters provisioning path
    // Transaction throws P2002
    // Second findUnique (retry): user found
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'user-race', tenantId: 'tenant-race' });

    const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002', clientVersion: '6.0.0' });
    mockPrisma.$transaction.mockRejectedValueOnce(p2002Error);

    const result = await resolveServiceAccountUser(CLAIMS);

    expect(result).toEqual({ userId: 'user-race', tenantId: 'tenant-race' });
    expect(mockLogger.warn).toHaveBeenCalledWith({ sub: 'sa-abc-123' }, 'Provisioning conflict — retrying lookup');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
  });

  // 8. Conflict/retry but user still not found after retry
  it('returns null when retry lookup after P2002 still finds no user', async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const p2002Error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002', clientVersion: '6.0.0' });
    mockPrisma.$transaction.mockRejectedValueOnce(p2002Error);

    const result = await resolveServiceAccountUser(CLAIMS);

    expect(result).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      { sub: 'sa-abc-123', error: p2002Error },
      'Failed to provision service account user',
    );
  });

  // 9. Non-constraint transaction failure
  it('returns null and logs error on non-constraint transaction failure', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const genericError = new Error('connection refused');
    mockPrisma.$transaction.mockRejectedValueOnce(genericError);

    const result = await resolveServiceAccountUser(CLAIMS);

    expect(result).toBeNull();
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      { sub: 'sa-abc-123', error: genericError },
      'Failed to provision service account user',
    );
  });
});
