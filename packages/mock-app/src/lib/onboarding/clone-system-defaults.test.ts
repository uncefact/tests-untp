import { cloneSystemDefaults } from './clone-system-defaults';

// Build a mock Prisma client whose $transaction executes the callback
// with the same mock, mirroring Prisma's interactive transaction API.
function createMockPrisma() {
  const mockPrisma = {
    $transaction: jest.fn(),
    serviceInstance: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    did: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
  };

  // Wire up $transaction to execute the callback with the mock itself
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: any) => any) => fn(mockPrisma));

  return mockPrisma;
}

const SYSTEM_SERVICE_INSTANCE = {
  id: 'system-did-vckit',
  organizationId: 'system',
  serviceType: 'DID',
  adapterType: 'VCKIT',
  name: 'System Default VCKit (DID)',
  description: 'System-wide default VCKit instance for DID management',
  config: '{"encrypted":"blob"}',
  isPrimary: false,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const SYSTEM_DEFAULT_DID = {
  id: 'did-1',
  organizationId: 'system',
  did: 'did:web:example.com',
  type: 'DEFAULT',
  method: 'DID_WEB',
  name: 'System Default DID',
  description: 'System-wide default DID',
  keyId: '',
  status: 'ACTIVE',
  isDefault: true,
  serviceInstanceId: 'system-did-vckit',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const TARGET_ORG_ID = 'org-new-123';

describe('cloneSystemDefaults', () => {
  it('clones service instances and DID into the target organisation', async () => {
    const mockPrisma = createMockPrisma();

    mockPrisma.serviceInstance.findMany.mockResolvedValue([SYSTEM_SERVICE_INSTANCE]);
    // First call: get system default DID, second call: check if cloned DID exists (should be null)
    mockPrisma.did.findFirst.mockResolvedValueOnce(SYSTEM_DEFAULT_DID).mockResolvedValueOnce(null);

    const clonedInstanceId = 'cloned-instance-1';
    mockPrisma.serviceInstance.create.mockResolvedValue({
      ...SYSTEM_SERVICE_INSTANCE,
      id: clonedInstanceId,
      organizationId: TARGET_ORG_ID,
    });

    mockPrisma.did.create.mockResolvedValue({
      ...SYSTEM_DEFAULT_DID,
      id: 'cloned-did-1',
      organizationId: TARGET_ORG_ID,
      isDefault: false,
    });

    const result = await cloneSystemDefaults(mockPrisma as never, TARGET_ORG_ID);

    expect(result).toBe(TARGET_ORG_ID);

    // Should have fetched system service instances
    expect(mockPrisma.serviceInstance.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'system' },
    });

    // Should have fetched system default DID
    expect(mockPrisma.did.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'system', isDefault: true },
    });

    // Should have cloned the service instance with the new org ID
    expect(mockPrisma.serviceInstance.create).toHaveBeenCalledWith({
      data: {
        organizationId: TARGET_ORG_ID,
        serviceType: 'DID',
        adapterType: 'VCKIT',
        name: 'System Default VCKit (DID)',
        description: 'System-wide default VCKit instance for DID management',
        config: '{"encrypted":"blob"}',
        isPrimary: false,
      },
    });

    // Should have cloned the DID with the new org ID
    expect(mockPrisma.did.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: TARGET_ORG_ID,
        type: 'DEFAULT',
        method: 'DID_WEB',
        name: 'System Default DID',
        description: 'System-wide default DID',
        keyId: '',
        status: 'ACTIVE',
        isDefault: false,
      }),
    });
  });

  it('links the cloned DID to the cloned service instance', async () => {
    const mockPrisma = createMockPrisma();

    mockPrisma.serviceInstance.findMany.mockResolvedValue([SYSTEM_SERVICE_INSTANCE]);
    // First call: get system default DID, second call: check if cloned DID exists (should be null)
    mockPrisma.did.findFirst.mockResolvedValueOnce(SYSTEM_DEFAULT_DID).mockResolvedValueOnce(null);

    const clonedInstanceId = 'cloned-instance-abc';
    mockPrisma.serviceInstance.create.mockResolvedValue({
      ...SYSTEM_SERVICE_INSTANCE,
      id: clonedInstanceId,
      organizationId: TARGET_ORG_ID,
    });

    await cloneSystemDefaults(mockPrisma as never, TARGET_ORG_ID);

    // The cloned DID should reference the cloned service instance, not the system one
    expect(mockPrisma.did.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serviceInstanceId: clonedInstanceId,
      }),
    });
  });

  it('is a no-op when the system org has no defaults', async () => {
    const mockPrisma = createMockPrisma();

    // No service instances and no default DID
    mockPrisma.serviceInstance.findMany.mockResolvedValue([]);
    mockPrisma.did.findFirst.mockResolvedValue(null);

    const result = await cloneSystemDefaults(mockPrisma as never, TARGET_ORG_ID);

    expect(result).toBe(TARGET_ORG_ID);
    expect(mockPrisma.serviceInstance.create).not.toHaveBeenCalled();
    expect(mockPrisma.did.create).not.toHaveBeenCalled();
  });

  it('uses a Prisma interactive transaction', async () => {
    const mockPrisma = createMockPrisma();

    await cloneSystemDefaults(mockPrisma as never, TARGET_ORG_ID);

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
  });

  it('clones the DID without a service instance link when no instances exist', async () => {
    const mockPrisma = createMockPrisma();

    const didWithoutService = { ...SYSTEM_DEFAULT_DID, serviceInstanceId: null };
    mockPrisma.serviceInstance.findMany.mockResolvedValue([]);
    // First call: get system default DID, second call: check if cloned DID exists (should be null)
    mockPrisma.did.findFirst.mockResolvedValueOnce(didWithoutService).mockResolvedValueOnce(null);

    await cloneSystemDefaults(mockPrisma as never, TARGET_ORG_ID);

    expect(mockPrisma.did.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serviceInstanceId: null,
      }),
    });
  });

  it('generates a unique DID string for the cloned DID', async () => {
    const mockPrisma = createMockPrisma();

    mockPrisma.serviceInstance.findMany.mockResolvedValue([SYSTEM_SERVICE_INSTANCE]);
    // First call: get system default DID, second call: check if cloned DID exists (should be null)
    mockPrisma.did.findFirst.mockResolvedValueOnce(SYSTEM_DEFAULT_DID).mockResolvedValueOnce(null);
    mockPrisma.serviceInstance.create.mockResolvedValue({
      ...SYSTEM_SERVICE_INSTANCE,
      id: 'cloned-1',
      organizationId: TARGET_ORG_ID,
    });

    await cloneSystemDefaults(mockPrisma as never, TARGET_ORG_ID);

    // The DID string should be derived from the system DID but include the org ID
    expect(mockPrisma.did.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        did: `${SYSTEM_DEFAULT_DID.did}:org:${TARGET_ORG_ID}`,
      }),
    });
  });

  it('clones multiple service instances', async () => {
    const mockPrisma = createMockPrisma();

    const secondInstance = {
      ...SYSTEM_SERVICE_INSTANCE,
      id: 'system-credential-vckit',
      name: 'System Default VCKit (Credential)',
    };

    mockPrisma.serviceInstance.findMany.mockResolvedValue([SYSTEM_SERVICE_INSTANCE, secondInstance]);
    mockPrisma.did.findFirst.mockResolvedValue(null);

    mockPrisma.serviceInstance.create
      .mockResolvedValueOnce({ ...SYSTEM_SERVICE_INSTANCE, id: 'cloned-1', organizationId: TARGET_ORG_ID })
      .mockResolvedValueOnce({ ...secondInstance, id: 'cloned-2', organizationId: TARGET_ORG_ID });

    await cloneSystemDefaults(mockPrisma as never, TARGET_ORG_ID);

    expect(mockPrisma.serviceInstance.create).toHaveBeenCalledTimes(2);
  });
});
