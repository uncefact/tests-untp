import { listCredentials } from './credential.repository';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

// Mock Prisma client. Use jest.fn() inside the factory to avoid hoisting issues.
jest.mock('../prisma', () => ({
  prisma: {
    credential: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from '../prisma';

const mockCredential = prisma.credential as unknown as {
  findMany: jest.Mock;
  count: jest.Mock;
};

describe('credential.repository', () => {
  const TENANT_ID = 'tenant-1';

  // More than DEFAULT_PAGE_LIMIT so an unbounded query is distinguishable
  // from a correctly-paged one.
  const SEED_CREDENTIALS = Array.from({ length: DEFAULT_PAGE_LIMIT + 5 }, (_, i) => ({
    id: `credential-${i}`,
    tenantId: TENANT_ID,
    storageUri: `https://storage.example/credential-${i}`,
    digestMultibase: `z${i}`,
    decryptionKey: null,
    credentialType: 'DigitalConformityCredential',
    isPublished: false,
    organisationId: null,
    facilityId: null,
    productId: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  }));

  beforeEach(() => {
    jest.clearAllMocks();
    // Mirrors Prisma's own take/skip semantics (an undefined take is
    // unbounded), so this catches the repository omitting the default
    // rather than merely asserting the call shape.
    mockCredential.findMany.mockImplementation(({ take, skip }: { take?: number; skip?: number } = {}) => {
      const start = skip ?? 0;
      const end = take !== undefined ? start + take : undefined;
      return Promise.resolve(SEED_CREDENTIALS.slice(start, end));
    });
    mockCredential.count.mockResolvedValue(SEED_CREDENTIALS.length);
  });

  describe('listCredentials', () => {
    it('bounds the result to DEFAULT_PAGE_LIMIT when limit is omitted', async () => {
      const result = await listCredentials({ tenantId: TENANT_ID });

      expect(mockCredential.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: DEFAULT_PAGE_LIMIT }));
      expect(result.data).toHaveLength(DEFAULT_PAGE_LIMIT);
    });

    it('still pages as requested when a limit is supplied', async () => {
      const result = await listCredentials({ tenantId: TENANT_ID, limit: 5, offset: 10 });

      expect(mockCredential.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5, skip: 10 }));
      expect(result.data).toHaveLength(5);
    });
  });
});
