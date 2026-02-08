import {
  createServiceInstance,
  getServiceInstanceById,
  listServiceInstances,
  updateServiceInstance,
  deleteServiceInstance,
  getInstanceByResolution,
} from "./service-instance.repository";

// Mock Prisma client — use jest.fn() inside the factory to avoid hoisting issues
jest.mock("../prisma", () => ({
  prisma: {
    serviceInstance: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
    },
  },
}));

// Import the mocked prisma after jest.mock
import { prisma } from "../prisma";

const mockServiceInstance = prisma.serviceInstance as unknown as {
  create: jest.Mock;
  findFirst: jest.Mock;
  findMany: jest.Mock;
  update: jest.Mock;
  updateMany: jest.Mock;
  delete: jest.Mock;
};

describe("service-instance.repository", () => {
  const ORG_ID = "org-1";
  const INSTANCE_RECORD = {
    id: "instance-1",
    organizationId: ORG_ID,
    serviceType: "DID",
    adapterType: "VCKIT",
    name: "Test VCKit Instance",
    description: null,
    config: "encrypted-config-blob",
    isPrimary: false,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("createServiceInstance", () => {
    it("creates with provided fields", async () => {
      mockServiceInstance.create.mockResolvedValue(INSTANCE_RECORD);

      const result = await createServiceInstance({
        organizationId: ORG_ID,
        serviceType: "DID",
        adapterType: "VCKIT",
        name: "Test VCKit Instance",
        config: "encrypted-config-blob",
      });

      expect(mockServiceInstance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          serviceType: "DID",
          adapterType: "VCKIT",
          name: "Test VCKit Instance",
          config: "encrypted-config-blob",
          isPrimary: false,
        }),
      });
      expect(result).toEqual(INSTANCE_RECORD);
    });

    it("defaults isPrimary to false", async () => {
      mockServiceInstance.create.mockResolvedValue(INSTANCE_RECORD);

      await createServiceInstance({
        organizationId: ORG_ID,
        serviceType: "DID",
        adapterType: "VCKIT",
        name: "Test",
        config: "encrypted",
      });

      expect(mockServiceInstance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isPrimary: false,
        }),
      });
    });

    it("unsets existing primary when isPrimary is true", async () => {
      const primaryRecord = { ...INSTANCE_RECORD, isPrimary: true };
      mockServiceInstance.updateMany.mockResolvedValue({ count: 1 });
      mockServiceInstance.create.mockResolvedValue(primaryRecord);

      await createServiceInstance({
        organizationId: ORG_ID,
        serviceType: "DID",
        adapterType: "VCKIT",
        name: "Primary Instance",
        config: "encrypted",
        isPrimary: true,
      });

      expect(mockServiceInstance.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          serviceType: "DID",
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
      expect(mockServiceInstance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          isPrimary: true,
        }),
      });
    });
  });

  describe("getServiceInstanceById", () => {
    it("returns instance for own organisation", async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);

      const result = await getServiceInstanceById("instance-1", ORG_ID);

      expect(mockServiceInstance.findFirst).toHaveBeenCalledWith({
        where: {
          id: "instance-1",
          OR: [{ organizationId: ORG_ID }, { organizationId: "system" }],
        },
      });
      expect(result).toEqual(INSTANCE_RECORD);
    });

    it("returns system default", async () => {
      const systemRecord = { ...INSTANCE_RECORD, organizationId: "system" };
      mockServiceInstance.findFirst.mockResolvedValue(systemRecord);

      const result = await getServiceInstanceById("instance-1", ORG_ID);

      expect(result).toEqual(systemRecord);
    });

    it("returns null for other organisation", async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      const result = await getServiceInstanceById("instance-1", "other-org");
      expect(result).toBeNull();
    });
  });

  describe("listServiceInstances", () => {
    it("lists for organisation including system defaults", async () => {
      mockServiceInstance.findMany.mockResolvedValue([INSTANCE_RECORD]);

      const result = await listServiceInstances(ORG_ID);

      expect(mockServiceInstance.findMany).toHaveBeenCalledWith({
        where: {
          OR: [{ organizationId: ORG_ID }, { organizationId: "system" }],
        },
        take: undefined,
        skip: undefined,
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual([INSTANCE_RECORD]);
    });

    it("applies serviceType filter", async () => {
      mockServiceInstance.findMany.mockResolvedValue([]);

      await listServiceInstances(ORG_ID, { serviceType: "DID" });

      expect(mockServiceInstance.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          serviceType: "DID",
        }),
        take: undefined,
        skip: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("applies adapterType filter", async () => {
      mockServiceInstance.findMany.mockResolvedValue([]);

      await listServiceInstances(ORG_ID, { adapterType: "VCKIT" });

      expect(mockServiceInstance.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          adapterType: "VCKIT",
        }),
        take: undefined,
        skip: undefined,
        orderBy: { createdAt: "desc" },
      });
    });

    it("applies pagination", async () => {
      mockServiceInstance.findMany.mockResolvedValue([]);

      await listServiceInstances(ORG_ID, { limit: 10, offset: 20 });

      expect(mockServiceInstance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });
  });

  describe("updateServiceInstance", () => {
    it("updates fields", async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);
      mockServiceInstance.update.mockResolvedValue({
        ...INSTANCE_RECORD,
        name: "Updated Name",
        description: "New description",
      });

      const result = await updateServiceInstance("instance-1", ORG_ID, {
        name: "Updated Name",
        description: "New description",
      });

      expect(mockServiceInstance.update).toHaveBeenCalledWith({
        where: { id: "instance-1" },
        data: { name: "Updated Name", description: "New description" },
      });
      expect(result.name).toBe("Updated Name");
    });

    it("throws for non-existent instance", async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      await expect(
        updateServiceInstance("non-existent", ORG_ID, { name: "New" }),
      ).rejects.toThrow("Service instance not found or access denied");
    });

    it("throws for system defaults (organisation mismatch)", async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      await expect(
        updateServiceInstance("instance-1", "other-org", { name: "New" }),
      ).rejects.toThrow("Service instance not found or access denied");
    });

    it("unsets existing primary when setting isPrimary", async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);
      mockServiceInstance.updateMany.mockResolvedValue({ count: 1 });
      mockServiceInstance.update.mockResolvedValue({
        ...INSTANCE_RECORD,
        isPrimary: true,
      });

      await updateServiceInstance("instance-1", ORG_ID, { isPrimary: true });

      expect(mockServiceInstance.updateMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          serviceType: "DID",
          isPrimary: true,
          NOT: { id: "instance-1" },
        },
        data: { isPrimary: false },
      });
      expect(mockServiceInstance.update).toHaveBeenCalledWith({
        where: { id: "instance-1" },
        data: { isPrimary: true },
      });
    });
  });

  describe("deleteServiceInstance", () => {
    it("deletes owned instance", async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);
      mockServiceInstance.delete.mockResolvedValue(INSTANCE_RECORD);

      const result = await deleteServiceInstance("instance-1", ORG_ID);

      expect(mockServiceInstance.findFirst).toHaveBeenCalledWith({
        where: { id: "instance-1", organizationId: ORG_ID },
      });
      expect(mockServiceInstance.delete).toHaveBeenCalledWith({
        where: { id: "instance-1" },
      });
      expect(result).toEqual(INSTANCE_RECORD);
    });

    it("throws for non-existent instance", async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      await expect(
        deleteServiceInstance("non-existent", ORG_ID),
      ).rejects.toThrow("Service instance not found or access denied");
    });

    it("throws for system defaults", async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      await expect(
        deleteServiceInstance("instance-1", "other-org"),
      ).rejects.toThrow("Service instance not found or access denied");
    });
  });

  describe("getInstanceByResolution", () => {
    it("returns explicit instance by ID (own organisation)", async () => {
      mockServiceInstance.findFirst.mockResolvedValue(INSTANCE_RECORD);

      const result = await getInstanceByResolution(ORG_ID, "DID", "instance-1");

      expect(mockServiceInstance.findFirst).toHaveBeenCalledWith({
        where: {
          id: "instance-1",
          OR: [{ organizationId: ORG_ID }, { organizationId: "system" }],
        },
      });
      expect(result).toEqual(INSTANCE_RECORD);
    });

    it("returns explicit instance by ID (system default)", async () => {
      const systemRecord = { ...INSTANCE_RECORD, organizationId: "system" };
      mockServiceInstance.findFirst.mockResolvedValue(systemRecord);

      const result = await getInstanceByResolution(ORG_ID, "DID", "instance-1");

      expect(result).toEqual(systemRecord);
    });

    it("returns null for explicit ID not accessible", async () => {
      mockServiceInstance.findFirst.mockResolvedValue(null);

      const result = await getInstanceByResolution(
        "other-org",
        "DID",
        "instance-1",
      );

      expect(result).toBeNull();
    });

    it("returns tenant primary when no explicit ID", async () => {
      const primaryRecord = { ...INSTANCE_RECORD, isPrimary: true };
      mockServiceInstance.findFirst.mockResolvedValue(primaryRecord);

      const result = await getInstanceByResolution(ORG_ID, "DID");

      expect(mockServiceInstance.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: ORG_ID,
          serviceType: "DID",
          isPrimary: true,
        },
      });
      expect(result).toEqual(primaryRecord);
    });

    it("returns system default when no tenant primary", async () => {
      const systemRecord = { ...INSTANCE_RECORD, organizationId: "system" };
      // First call: tenant primary lookup returns null
      mockServiceInstance.findFirst.mockResolvedValueOnce(null);
      // Second call: system default lookup returns the system record
      mockServiceInstance.findFirst.mockResolvedValueOnce(systemRecord);

      const result = await getInstanceByResolution(ORG_ID, "DID");

      expect(mockServiceInstance.findFirst).toHaveBeenCalledTimes(2);
      expect(mockServiceInstance.findFirst).toHaveBeenNthCalledWith(1, {
        where: {
          organizationId: ORG_ID,
          serviceType: "DID",
          isPrimary: true,
        },
      });
      expect(mockServiceInstance.findFirst).toHaveBeenNthCalledWith(2, {
        where: {
          organizationId: "system",
          serviceType: "DID",
        },
      });
      expect(result).toEqual(systemRecord);
    });

    it("returns null when nothing found", async () => {
      // First call: tenant primary lookup returns null
      mockServiceInstance.findFirst.mockResolvedValueOnce(null);
      // Second call: system default lookup returns null
      mockServiceInstance.findFirst.mockResolvedValueOnce(null);

      const result = await getInstanceByResolution(ORG_ID, "DID");

      expect(mockServiceInstance.findFirst).toHaveBeenCalledTimes(2);
      expect(result).toBeNull();
    });
  });
});
