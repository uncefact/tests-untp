const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.mock('@uncefact/untp-ri-services/logging', () => ({
  createLogger: () => ({ child: () => mockLogger }),
}));

const mockPrisma: any = {
  tenant: { findUnique: jest.fn(), create: jest.fn() },
  user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  $transaction: jest.fn((cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma)),
};
jest.mock('@/lib/prisma/prisma', () => ({ prisma: mockPrisma }));

import { resolveClosedModeTenant } from './resolve-closed-mode-tenant';

beforeEach(() => {
  jest.resetAllMocks();
  mockPrisma.$transaction.mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma));
});

describe('resolveClosedModeTenant', () => {
  // Case 3: tenant found + user found + user linked to this tenant
  it('returns fast path when tenant and user both exist and are linked', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1' });

    const result = await resolveClosedModeTenant('/acme-corp', 'sub-1');
    expect(result).toEqual({ userId: 'user-1', tenantId: 'tenant-1' });
  });

  // Case 4: tenant found + user found + user linked to DIFFERENT tenant
  it('re-links user to new tenant when group changes', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-2' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1' });
    mockPrisma.user.update.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-2' });

    const result = await resolveClosedModeTenant('/new-group', 'sub-1');
    expect(result).toEqual({ userId: 'user-1', tenantId: 'tenant-2' });
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { tenantId: 'tenant-2' },
    });
  });

  // Case 5: tenant found + user not found
  it('creates user when tenant exists but user does not', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 'user-new' });

    const result = await resolveClosedModeTenant('/acme', 'sub-new', { name: 'Alice' });
    expect(result).toEqual({ userId: 'user-new', tenantId: 'tenant-1' });
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        authProviderId: 'sub-new',
        name: 'Alice',
        email: null,
        tenantId: 'tenant-1',
      },
    });
  });

  // Case 6: tenant not found + user found
  it('creates tenant and re-links existing user', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', tenantId: 'old-tenant' });
    mockPrisma.tenant.create.mockResolvedValue({ id: 'tenant-new' });
    mockPrisma.user.update.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-new' });

    const result = await resolveClosedModeTenant('/brand-new', 'sub-1');
    expect(result).toEqual({ userId: 'user-1', tenantId: 'tenant-new' });
    expect(mockPrisma.tenant.create).toHaveBeenCalledWith({
      data: { name: 'My Organisation', externalIdpGroupId: '/brand-new' },
    });
  });

  // Case 7: tenant not found + user not found
  it('creates both tenant and user in transaction', async () => {
    mockPrisma.tenant.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.tenant.create.mockResolvedValue({ id: 'tenant-new' });
    mockPrisma.user.create.mockResolvedValue({ id: 'user-new' });

    const result = await resolveClosedModeTenant('/new-group', 'sub-new');
    expect(result).toEqual({ userId: 'user-new', tenantId: 'tenant-new' });
  });

  // P2002 retry
  it('retries full resolution on P2002 unique constraint violation', async () => {
    // First attempt: transaction throws P2002
    mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });
    // Second attempt (retry): succeeds
    mockPrisma.$transaction.mockImplementationOnce((cb: (tx: unknown) => Promise<unknown>) => cb(mockPrisma));
    mockPrisma.tenant.findUnique.mockResolvedValue({ id: 'tenant-1' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', tenantId: 'tenant-1' });

    const result = await resolveClosedModeTenant('/acme', 'sub-1');
    expect(result).toEqual({ userId: 'user-1', tenantId: 'tenant-1' });
  });

  // Non-P2002 error
  it('returns null on non-P2002 transaction error', async () => {
    mockPrisma.$transaction.mockRejectedValue(new Error('connection lost'));

    const result = await resolveClosedModeTenant('/acme', 'sub-1');
    expect(result).toBeNull();
  });
});
