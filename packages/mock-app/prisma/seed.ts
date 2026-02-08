import dotenv from "dotenv";
import path from "path";
import { DidMethod, DidStatus, DidType, PrismaClient, ServiceType as PrismaServiceType, AdapterType as PrismaAdapterType } from "../src/lib/prisma/generated";
import { AesGcmEncryptionAdapter } from "@uncefact/untp-ri-services/server";
import { EncryptionAlgorithm } from "@uncefact/untp-ri-services";
import { getDidConfig } from "../src/lib/config/did.config";

// Load .env before accessing config (seed runs outside Next.js)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

// Construct RI_DATABASE_URL from individual env vars (same as prisma.config.ts)
// In Docker, these come from docker-compose; locally, from .env
const { RI_POSTGRES_USER, RI_POSTGRES_PASSWORD, RI_POSTGRES_DB, RI_POSTGRES_HOST, RI_POSTGRES_PORT } = process.env;
if (RI_POSTGRES_USER && RI_POSTGRES_PASSWORD && RI_POSTGRES_DB && RI_POSTGRES_HOST && RI_POSTGRES_PORT) {
  process.env.RI_DATABASE_URL = `postgresql://${RI_POSTGRES_USER}:${RI_POSTGRES_PASSWORD}@${RI_POSTGRES_HOST}:${RI_POSTGRES_PORT}/${RI_POSTGRES_DB}?schema=public`;
}

const prisma = new PrismaClient();
const { defaultDid: DEFAULT_DID } = getDidConfig();

const SYSTEM_ORG_ID = "system";

const ENCRYPTION_KEY = process.env.SERVICE_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error(
    "Missing required SERVICE_ENCRYPTION_KEY environment variable. " +
    "Set this in your .env file or environment."
  );
}
const encryptionService = new AesGcmEncryptionAdapter(ENCRYPTION_KEY);

async function main() {
  // Upsert the system organisation (used for system-wide defaults)
  await prisma.organization.upsert({
    where: { id: SYSTEM_ORG_ID },
    update: {},
    create: {
      id: SYSTEM_ORG_ID,
      name: "System",
    },
  });

  // Upsert the system default DID
  await prisma.did.upsert({
    where: { did: DEFAULT_DID },
    update: {
      name: "System Default DID",
      description:
        "System-wide default DID for the UNTP reference implementation",
      status: DidStatus.ACTIVE,
      isDefault: true,
    },
    create: {
      organizationId: SYSTEM_ORG_ID,
      did: DEFAULT_DID,
      type: DidType.DEFAULT,
      method: DidMethod.DID_WEB,
      name: "System Default DID",
      description:
        "System-wide default DID for the UNTP reference implementation",
      keyId: "",
      status: DidStatus.ACTIVE,
      isDefault: true,
    },
  });

  // Upsert the system default VCKit DID service instance
  const { vckitApiUrl, vckitAuthToken } = getDidConfig();
  const didServiceConfig = JSON.stringify({
    endpoint: new URL(vckitApiUrl).origin,
    authToken: vckitAuthToken,
  });
  const encryptedConfig = JSON.stringify(encryptionService.encrypt(didServiceConfig, EncryptionAlgorithm.AES_256_GCM));

  const systemDidInstance = await prisma.serviceInstance.upsert({
    where: { id: "system-did-vckit" },
    update: { config: encryptedConfig },
    create: {
      id: "system-did-vckit",
      organizationId: SYSTEM_ORG_ID,
      serviceType: PrismaServiceType.DID,
      adapterType: PrismaAdapterType.VCKIT,
      name: "System Default VCKit (DID)",
      description: "System-wide default VCKit instance for DID management",
      config: encryptedConfig,
      isPrimary: false,
    },
  });

  // Update the system default DID to reference the service instance
  await prisma.did.updateMany({
    where: { did: DEFAULT_DID },
    data: { serviceInstanceId: systemDidInstance.id },
  });

  console.log(
    "Seed complete: system organisation, default DID, and DID service instance upserted",
  );
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
