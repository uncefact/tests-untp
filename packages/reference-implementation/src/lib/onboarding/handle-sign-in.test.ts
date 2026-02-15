jest.mock('@/lib/prisma/generated', () => ({}));
jest.mock('./clone-system-defaults', () => ({
  cloneSystemDefaults: jest.fn().mockResolvedValue(undefined),
}));

import { handleSignIn } from './handle-sign-in';
import { cloneSystemDefaults } from './clone-system-defaults';

const mockCloneSystemDefaults = cloneSystemDefaults as jest.Mock;

function buildMockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    tenant: {
      create: jest.fn(),
    },
    ...overrides,
  } as unknown as Parameters<typeof handleSignIn>[0];
}

const ACCOUNT = { providerAccountId: 'kc-12345' };

describe('handleSignIn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

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
    expect(mockCloneSystemDefaults).not.toHaveBeenCalled();
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

  it('calls cloneSystemDefaults with the new tenant ID', async () => {
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
    tenantModel.create.mockResolvedValue({ id: 'new-org-4' });

    await handleSignIn(prisma, 'user-4', ACCOUNT, {
      name: 'Charlie',
    });

    expect(mockCloneSystemDefaults).toHaveBeenCalledWith(prisma, 'new-org-4');
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
    expect(mockCloneSystemDefaults).toHaveBeenCalledWith(prisma, 'new-org-5');
  });
});
