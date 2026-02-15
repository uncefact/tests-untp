import dotenv from 'dotenv';
import path from 'path';
import {
  DidMethod,
  DidStatus,
  DidType,
  PrismaClient,
  ServiceType as PrismaServiceType,
  AdapterType as PrismaAdapterType,
} from '../src/lib/prisma/generated';
import { AesGcmEncryptionAdapter } from '@uncefact/untp-ri-services/server';
import { EncryptionAlgorithm, createLogger } from '@uncefact/untp-ri-services';
import { getDidConfig } from '../src/lib/config/did.config';
import { getIdrConfig } from '../src/lib/config/idr.config';

const logger = createLogger().child({ module: 'prisma-seed' });

// Load .env before accessing config (seed runs outside Next.js)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Construct RI_DATABASE_URL from individual env vars (same as prisma.config.ts)
// In Docker, these come from docker-compose; locally, from .env
const { RI_POSTGRES_USER, RI_POSTGRES_PASSWORD, RI_POSTGRES_DB, RI_POSTGRES_HOST, RI_POSTGRES_PORT } = process.env;
if (RI_POSTGRES_USER && RI_POSTGRES_PASSWORD && RI_POSTGRES_DB && RI_POSTGRES_HOST && RI_POSTGRES_PORT) {
  process.env.RI_DATABASE_URL = `postgresql://${RI_POSTGRES_USER}:${RI_POSTGRES_PASSWORD}@${RI_POSTGRES_HOST}:${RI_POSTGRES_PORT}/${RI_POSTGRES_DB}?schema=public`;
}

const prisma = new PrismaClient();
const { defaultDid: DEFAULT_DID } = getDidConfig();

const SYSTEM_TENANT_ID = 'system';

const ENCRYPTION_KEY = process.env.SERVICE_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error(
    'Missing required SERVICE_ENCRYPTION_KEY environment variable. ' + 'Set this in your .env file or environment.',
  );
}
const encryptionService = new AesGcmEncryptionAdapter(ENCRYPTION_KEY, logger);

async function main() {
  // Upsert the system tenant (used for system-wide defaults)
  await prisma.tenant.upsert({
    where: { id: SYSTEM_TENANT_ID },
    update: {},
    create: {
      id: SYSTEM_TENANT_ID,
      name: 'System',
    },
  });

  // Upsert the system default DID
  await prisma.did.upsert({
    where: { did: DEFAULT_DID },
    update: {
      name: 'System Default DID',
      description: 'System-wide default DID for the UNTP reference implementation',
      status: DidStatus.ACTIVE,
      isDefault: true,
    },
    create: {
      tenantId: SYSTEM_TENANT_ID,
      did: DEFAULT_DID,
      type: DidType.DEFAULT,
      method: DidMethod.DID_WEB,
      name: 'System Default DID',
      description: 'System-wide default DID for the UNTP reference implementation',
      keyId: '',
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
    where: { id: 'system-did-vckit' },
    update: { config: encryptedConfig },
    create: {
      id: 'system-did-vckit',
      tenantId: SYSTEM_TENANT_ID,
      serviceType: PrismaServiceType.DID,
      adapterType: PrismaAdapterType.VCKIT,
      name: 'System Default VCKit (DID)',
      description: 'System-wide default VCKit instance for DID management',
      config: encryptedConfig,
      apiVersion: '1.1.0',
      isPrimary: false,
    },
  });

  // Update the system default DID to reference the service instance
  await prisma.did.updateMany({
    where: { did: DEFAULT_DID },
    data: { serviceInstanceId: systemDidInstance.id },
  });

  // ── Seed system registrars ──────────────────────────────────────────────────

  const gs1Registrar = await prisma.registrar.upsert({
    where: { id: 'system-registrar-gs1' },
    update: {},
    create: {
      id: 'system-registrar-gs1',
      tenantId: SYSTEM_TENANT_ID,
      name: 'GS1',
      namespace: 'gs1',
      url: 'https://www.gs1.org',
      isDefault: true,
    },
  });

  const abrRegistrar = await prisma.registrar.upsert({
    where: { id: 'system-registrar-abr' },
    update: {},
    create: {
      id: 'system-registrar-abr',
      tenantId: SYSTEM_TENANT_ID,
      name: 'Australian Business Register',
      namespace: 'abr',
      url: 'https://abr.business.gov.au',
      isDefault: true,
    },
  });

  const asicRegistrar = await prisma.registrar.upsert({
    where: { id: 'system-registrar-asic' },
    update: {},
    create: {
      id: 'system-registrar-asic',
      tenantId: SYSTEM_TENANT_ID,
      name: 'ASIC',
      namespace: 'asic',
      url: 'https://asic.gov.au',
      isDefault: true,
    },
  });

  // ── Seed system identifier schemes ──────────────────────────────────────────

  await prisma.identifierScheme.upsert({
    where: { id: 'system-scheme-abn' },
    update: {},
    create: {
      id: 'system-scheme-abn',
      tenantId: SYSTEM_TENANT_ID,
      registrarId: abrRegistrar.id,
      name: 'Australian Business Number',
      primaryKey: 'abn',
      validationPattern: '^\\d{11}$',
      isDefault: true,
    },
  });

  await prisma.identifierScheme.upsert({
    where: { id: 'system-scheme-acn' },
    update: {},
    create: {
      id: 'system-scheme-acn',
      tenantId: SYSTEM_TENANT_ID,
      registrarId: asicRegistrar.id,
      name: 'Australian Company Number',
      primaryKey: 'acn',
      validationPattern: '^\\d{9}$',
      isDefault: true,
    },
  });

  await prisma.identifierScheme.upsert({
    where: { id: 'system-scheme-gln' },
    update: {},
    create: {
      id: 'system-scheme-gln',
      tenantId: SYSTEM_TENANT_ID,
      registrarId: gs1Registrar.id,
      name: 'GS1 Global Location Number',
      primaryKey: 'gln',
      validationPattern: '^\\d{13}$',
      isDefault: true,
    },
  });

  const gtinScheme = await prisma.identifierScheme.upsert({
    where: { id: 'system-scheme-gtin' },
    update: {},
    create: {
      id: 'system-scheme-gtin',
      tenantId: SYSTEM_TENANT_ID,
      registrarId: gs1Registrar.id,
      name: 'GS1 Global Trade Item Number',
      primaryKey: '01',
      validationPattern: '^\\d{14}$',
      isDefault: true,
    },
  });

  // ── Seed GTIN qualifiers ────────────────────────────────────────────────────

  await prisma.schemeQualifier.upsert({
    where: { id: 'system-qualifier-batch' },
    update: {},
    create: {
      id: 'system-qualifier-batch',
      schemeId: gtinScheme.id,
      key: '10',
      description: 'Batch/Lot Number',
      validationPattern: '^[A-Za-z0-9]{1,20}$',
    },
  });

  await prisma.schemeQualifier.upsert({
    where: { id: 'system-qualifier-serial' },
    update: {},
    create: {
      id: 'system-qualifier-serial',
      schemeId: gtinScheme.id,
      key: '21',
      description: 'Serial Number',
      validationPattern: '^[A-Za-z0-9]{1,20}$',
    },
  });

  // ── Seed system Pyx IDR service instance ────────────────────────────────────

  let idrSeeded = false;
  try {
    const { pyxIdrApiUrl, pyxIdrApiKey } = getIdrConfig();
    const idrServiceConfig = JSON.stringify({
      baseUrl: new URL(pyxIdrApiUrl).origin,
      apiKey: pyxIdrApiKey,
    });
    const encryptedIdrConfig = JSON.stringify(
      encryptionService.encrypt(idrServiceConfig, EncryptionAlgorithm.AES_256_GCM),
    );

    await prisma.serviceInstance.upsert({
      where: { id: 'system-idr-pyx' },
      update: { config: encryptedIdrConfig },
      create: {
        id: 'system-idr-pyx',
        tenantId: SYSTEM_TENANT_ID,
        serviceType: PrismaServiceType.IDR,
        adapterType: PrismaAdapterType.PYX_IDR,
        name: 'System Default Pyx IDR',
        description: 'System-wide default Pyx Identity Resolver instance',
        config: encryptedIdrConfig,
        apiVersion: '2.0.2',
        isPrimary: true,
      },
    });
    idrSeeded = true;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : error },
      'Skipping IDR service instance seed: IDR configuration not available',
    );
  }

  logger.info(
    'Seed complete: system tenant, default DID, DID service instance, ' +
      'registrars, schemes, qualifiers' +
      (idrSeeded ? ', and IDR service instance' : '') +
      ' upserted',
  );
}

main()
  .catch((e) => {
    logger.error({ error: e }, 'Seed failed');
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
