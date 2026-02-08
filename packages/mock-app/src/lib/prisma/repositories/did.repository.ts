import { Did, DidStatus, Prisma } from "../generated";
import { prisma } from "../prisma";
import { NotFoundError } from "@/lib/api/errors";

/**
 * Input for creating a new DID record
 */
export type CreateDidInput = {
  organizationId: string;
  did: string;
  type: "DEFAULT" | "MANAGED" | "SELF_MANAGED";
  method?: "DID_WEB" | "DID_WEB_VH";
  keyId: string;
  name?: string;
  description?: string;
  isDefault?: boolean;
  status?: "ACTIVE" | "INACTIVE" | "VERIFIED" | "UNVERIFIED";
  serviceInstanceId?: string;
};

/**
 * Input for updating a DID record
 */
export type UpdateDidInput = {
  name?: string;
  description?: string;
};

/**
 * Options for listing DIDs
 */
export type ListDidsOptions = {
  type?: "DEFAULT" | "MANAGED" | "SELF_MANAGED";
  status?: "ACTIVE" | "INACTIVE" | "VERIFIED" | "UNVERIFIED";
  serviceInstanceId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Creates a new DID record scoped to an organisation
 */
export async function createDid(input: CreateDidInput): Promise<Did> {
  return prisma.did.create({
    data: {
      organizationId: input.organizationId,
      did: input.did,
      type: input.type,
      method: input.method ?? "DID_WEB",
      keyId: input.keyId,
      name: input.name ?? input.did,
      description: input.description,
      isDefault: input.isDefault ?? false,
      status: input.status ?? "UNVERIFIED",
      serviceInstanceId: input.serviceInstanceId,
    },
  });
}

/**
 * Retrieves a DID by ID, scoped to an organisation.
 * Returns null if the DID does not exist or belongs to a different organisation.
 */
export async function getDidById(
  id: string,
  organizationId: string,
): Promise<Did | null> {
  return prisma.did.findFirst({
    where: {
      id,
      OR: [{ organizationId }, { isDefault: true }],
    },
  });
}

/**
 * Lists DIDs for an organisation, including system defaults.
 */
export async function listDids(
  organizationId: string,
  options: ListDidsOptions = {},
): Promise<Did[]> {
  const { type, status, serviceInstanceId, limit, offset } = options;

  const where: Prisma.DidWhereInput = {
    OR: [{ organizationId }, { isDefault: true }],
  };

  if (type !== undefined) {
    where.type = type;
  }

  if (status !== undefined) {
    where.status = status;
  }

  if (serviceInstanceId !== undefined) {
    where.serviceInstanceId = serviceInstanceId;
  }

  return prisma.did.findMany({
    where,
    take: limit,
    skip: offset,
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Updates a DID's name and/or description.
 * Validates that the DID belongs to the specified organisation.
 */
export async function updateDid(
  id: string,
  organizationId: string,
  input: UpdateDidInput,
): Promise<Did> {
  // Verify ownership before updating
  const existing = await prisma.did.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    throw new NotFoundError("DID not found or access denied");
  }

  return prisma.did.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
    },
  });
}

/**
 * Updates a DID's status (used for verification flow).
 * Validates that the DID belongs to the specified organisation.
 */
export async function updateDidStatus(
  id: string,
  organizationId: string,
  status: DidStatus,
): Promise<Did> {
  const existing = await prisma.did.findFirst({
    where: { id, organizationId },
  });

  if (!existing) {
    throw new NotFoundError("DID not found or access denied");
  }

  return prisma.did.update({
    where: { id },
    data: { status },
  });
}

/**
 * Returns the system default DID (if seeded).
 */
export async function getDefaultDid(): Promise<Did | null> {
  return prisma.did.findFirst({
    where: { isDefault: true },
  });
}
