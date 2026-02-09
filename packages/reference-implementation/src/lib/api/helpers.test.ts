import { getOrganizationId, getSessionUserId } from './helpers';

// Mock prisma - use inline object to avoid hoisting issues
jest.mock('@/lib/prisma/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn(),
    },
  },
}));

// Mock auth
jest.mock('@/auth', () => ({
  auth: jest.fn(),
}));

// Import mocked modules to access mock functions
import { prisma } from '@/lib/prisma/prisma';
import { auth } from '@/auth';

const mockFindUnique = prisma.user.findUnique as jest.Mock;
const mockAuth = auth as jest.Mock;

describe('API helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrganizationId', () => {
    it('returns the organization ID for a valid user', async () => {
      mockFindUnique.mockResolvedValue({ organizationId: 'org-1' });

      const result = await getOrganizationId('user-1');

      expect(mockFindUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: { organizationId: true },
      });
      expect(result).toBe('org-1');
    });

    it('returns null if user not found', async () => {
      mockFindUnique.mockResolvedValue(null);

      const result = await getOrganizationId('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null if user has no organisation', async () => {
      mockFindUnique.mockResolvedValue({ organizationId: null });

      const result = await getOrganizationId('user-1');
      expect(result).toBeNull();
    });
  });

  describe('getSessionUserId', () => {
    it('returns user ID from session', async () => {
      mockAuth.mockResolvedValue({ user: { id: 'user-1' } });

      const result = await getSessionUserId();
      expect(result).toBe('user-1');
    });

    it('returns null if no session', async () => {
      mockAuth.mockResolvedValue(null);

      const result = await getSessionUserId();
      expect(result).toBeNull();
    });

    it('returns null if session has no user', async () => {
      mockAuth.mockResolvedValue({});

      const result = await getSessionUserId();
      expect(result).toBeNull();
    });
  });
});
