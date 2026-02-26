import type { Adapter, AdapterUser } from 'next-auth/adapters';
import { withPreProvisionedUserLookup } from './adapter-wrapper';

// -- Mocks -------------------------------------------------------------------

jest.mock('@uncefact/untp-ri-services/logging', () => ({
  createLogger: () => ({
    child: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    }),
  }),
}));

// -- Helpers -----------------------------------------------------------------

function createMockPrisma(findUniqueResult: unknown = null) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(findUniqueResult),
    },
  } as unknown as Parameters<typeof withPreProvisionedUserLookup>[1];
}

function createMockBaseAdapter(overrides: Partial<Adapter> = {}): Adapter {
  return {
    createUser: jest.fn().mockResolvedValue({
      id: 'new-cuid-123',
      name: 'New User',
      email: 'new@example.com',
      emailVerified: null,
      image: null,
    } satisfies AdapterUser),
    getUser: jest.fn().mockResolvedValue(null),
    getUserByEmail: jest.fn().mockResolvedValue(null),
    getUserByAccount: jest.fn().mockResolvedValue(null),
    updateUser: jest.fn(),
    linkAccount: jest.fn(),
    createSession: jest.fn(),
    getSessionAndUser: jest.fn(),
    updateSession: jest.fn(),
    deleteSession: jest.fn(),
    ...overrides,
  };
}

const preProvisionedUser = {
  id: 'existing-user-id',
  authProviderId: 'keycloak-sub-123',
  name: 'Pre-Provisioned User',
  email: 'provisioned@example.com',
  emailVerified: new Date('2026-01-15T00:00:00Z'),
  image: 'https://example.com/avatar.png',
  tenantId: 'tenant-abc',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const profileData: AdapterUser & { id: string } = {
  id: 'keycloak-sub-123',
  name: 'Pre-Provisioned User',
  email: 'provisioned@example.com',
  emailVerified: null,
  image: null,
};

// -- Tests -------------------------------------------------------------------

describe('withPreProvisionedUserLookup', () => {
  describe('createUser', () => {
    it('returns the pre-provisioned user when one is found by authProviderId', async () => {
      const mockPrisma = createMockPrisma(preProvisionedUser);
      const baseAdapter = createMockBaseAdapter();
      const wrappedAdapter = withPreProvisionedUserLookup(baseAdapter, mockPrisma);

      const result = await wrappedAdapter.createUser!(profileData);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { authProviderId: 'keycloak-sub-123' },
      });

      expect(result).toEqual({
        id: 'existing-user-id',
        name: 'Pre-Provisioned User',
        email: 'provisioned@example.com',
        emailVerified: preProvisionedUser.emailVerified,
        image: 'https://example.com/avatar.png',
      });

      expect(baseAdapter.createUser).not.toHaveBeenCalled();
    });

    it('falls back to profile email when pre-provisioned user has null email', async () => {
      const userWithNullEmail = { ...preProvisionedUser, email: null };
      const mockPrisma = createMockPrisma(userWithNullEmail);
      const baseAdapter = createMockBaseAdapter();
      const wrappedAdapter = withPreProvisionedUserLookup(baseAdapter, mockPrisma);

      const result = await wrappedAdapter.createUser!(profileData);

      expect(result.email).toBe('provisioned@example.com');
      expect(baseAdapter.createUser).not.toHaveBeenCalled();
    });

    it('delegates to the base adapter when no pre-provisioned user is found', async () => {
      const mockPrisma = createMockPrisma(null);
      const baseAdapter = createMockBaseAdapter();
      const wrappedAdapter = withPreProvisionedUserLookup(baseAdapter, mockPrisma);

      const result = await wrappedAdapter.createUser!(profileData);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { authProviderId: 'keycloak-sub-123' },
      });

      expect(baseAdapter.createUser).toHaveBeenCalledWith(profileData);

      expect(result).toEqual({
        id: 'new-cuid-123',
        name: 'New User',
        email: 'new@example.com',
        emailVerified: null,
        image: null,
      });
    });

    it('delegates to the base adapter when profile data has no id', async () => {
      const mockPrisma = createMockPrisma();
      const baseAdapter = createMockBaseAdapter();
      const wrappedAdapter = withPreProvisionedUserLookup(baseAdapter, mockPrisma);

      const dataWithoutId = {
        ...profileData,
        id: '',
      };

      await wrappedAdapter.createUser!(dataWithoutId);

      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(baseAdapter.createUser).toHaveBeenCalledWith(dataWithoutId);
    });
  });

  describe('pass-through methods', () => {
    it('preserves other adapter methods from the base adapter', () => {
      const mockGetUser = jest.fn().mockResolvedValue({ id: 'user-1' });
      const mockLinkAccount = jest.fn().mockResolvedValue(undefined);

      const baseAdapter = createMockBaseAdapter({
        getUser: mockGetUser,
        linkAccount: mockLinkAccount,
      });
      const mockPrisma = createMockPrisma();
      const wrappedAdapter = withPreProvisionedUserLookup(baseAdapter, mockPrisma);

      expect(wrappedAdapter.getUser).toBe(mockGetUser);
      expect(wrappedAdapter.linkAccount).toBe(mockLinkAccount);
    });

    it('retains all base adapter methods on the wrapped adapter', () => {
      const baseAdapter = createMockBaseAdapter();
      const mockPrisma = createMockPrisma();
      const wrappedAdapter = withPreProvisionedUserLookup(baseAdapter, mockPrisma);

      expect(wrappedAdapter.getUser).toBe(baseAdapter.getUser);
      expect(wrappedAdapter.getUserByEmail).toBe(baseAdapter.getUserByEmail);
      expect(wrappedAdapter.getUserByAccount).toBe(baseAdapter.getUserByAccount);
      expect(wrappedAdapter.updateUser).toBe(baseAdapter.updateUser);
      expect(wrappedAdapter.linkAccount).toBe(baseAdapter.linkAccount);
      expect(wrappedAdapter.createSession).toBe(baseAdapter.createSession);
      expect(wrappedAdapter.getSessionAndUser).toBe(baseAdapter.getSessionAndUser);
      expect(wrappedAdapter.updateSession).toBe(baseAdapter.updateSession);
      expect(wrappedAdapter.deleteSession).toBe(baseAdapter.deleteSession);
    });
  });
});
