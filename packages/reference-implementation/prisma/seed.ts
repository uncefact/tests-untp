import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  CredentialType,
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
import { getStorageConfig } from '../src/lib/config/storage.config';
import { getVcConfig } from '../src/lib/config/vc.config';

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
      linkTemplate: '/{primaryKey}/{value}',
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
      linkTemplate: '/{primaryKey}/{value}',
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
      linkTemplate: '/{primaryKey}/{value}',
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
      linkTemplate: '/{primaryKey}/{value}',
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
      order: 0,
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
      order: 1,
    },
  });

  // ── Seed system Pyx IDR service instance ────────────────────────────────────

  let idrSeeded = false;
  try {
    const { pyxIdrApiUrl, pyxIdrApiKey } = getIdrConfig();
    const idrServiceConfig = JSON.stringify({
      baseUrl: new URL(pyxIdrApiUrl).origin,
      apiKey: pyxIdrApiKey,
      apiVersion: '2.0.0',
      ianaLanguage: 'en',
      context: 'au',
      defaultLinkType: 'untp:dpp',
      defaultMimeType: 'text/html',
      defaultIanaLanguage: 'en',
      defaultContext: 'au',
      fwqs: false,
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
        apiVersion: '2.0.0',
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

  // ── Seed system UNCEFACT storage service instance ───────────────────────────

  let storageSeeded = false;
  try {
    const { storageServiceUrl } = getStorageConfig();
    const storageApiKey = process.env.UNCEFACT_STORAGE_API_KEY;
    const storageServiceConfig = JSON.stringify({
      baseUrl: new URL(storageServiceUrl).origin,
      ...(storageApiKey && { apiKey: storageApiKey }),
      apiVersion: '3.0.0',
      publicBucket: 'verifiable-credentials',
      privateBucket: 'private-verifiable-credentials',
    });
    const encryptedStorageConfig = JSON.stringify(
      encryptionService.encrypt(storageServiceConfig, EncryptionAlgorithm.AES_256_GCM),
    );

    await prisma.serviceInstance.upsert({
      where: { id: 'system-storage-uncefact' },
      update: { config: encryptedStorageConfig },
      create: {
        id: 'system-storage-uncefact',
        tenantId: SYSTEM_TENANT_ID,
        serviceType: PrismaServiceType.STORAGE,
        adapterType: PrismaAdapterType.UNCEFACT_STORAGE,
        name: 'System Default UNCEFACT Storage',
        description: 'System-wide default UNCEFACT storage instance for credential persistence',
        config: encryptedStorageConfig,
        apiVersion: '3.0.0',
        isPrimary: true,
      },
    });
    storageSeeded = true;
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : error },
      'Skipping storage service instance seed: storage configuration not available',
    );
  }

  // ── Seed system VCKit VC service instance ─────────────────────────────────
  let vcSeeded = false;
  try {
    const { vckitApiUrl, vckitApiKey } = getVcConfig();
    const vcServiceConfig = JSON.stringify({
      endpoint: new URL(vckitApiUrl).origin,
      apiKey: vckitApiKey,
      apiVersion: '1.0.0',
    });
    const encryptedVcConfig = JSON.stringify(
      encryptionService.encrypt(vcServiceConfig, EncryptionAlgorithm.AES_256_GCM),
    );

    await prisma.serviceInstance.upsert({
      where: { id: 'system-vc-vckit' },
      update: { config: encryptedVcConfig },
      create: {
        id: 'system-vc-vckit',
        tenantId: SYSTEM_TENANT_ID,
        serviceType: PrismaServiceType.VC,
        adapterType: PrismaAdapterType.VCKIT,
        name: 'System Default VCKit',
        description: 'System-wide default VCKit instance for DID management and verifiable credential operations',
        config: encryptedVcConfig,
        apiVersion: '1.0.0',
        isPrimary: true,
      },
    });
    vcSeeded = true;

    // Link the system default DID to the VC service instance
    await prisma.did.updateMany({
      where: { did: DEFAULT_DID },
      data: { serviceInstanceId: 'system-vc-vckit' },
    });
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : error },
      'Skipping VC service instance seed: VC configuration not available',
    );
  }

  // ── Seed core data model configs ────────────────────────────────────────────
  // Static UUIDs ensure idempotent seeding — if the record already exists, skip.

  const UNTP_BASE = 'https://test.uncefact.org/vocabulary/untp';

  const coreDataModels = [
    {
      id: 'a1b2c3d4-0001-4000-8000-000000000001',
      templateId: 'b2c3d4e5-0001-4000-8000-000000000001',
      credentialType: CredentialType.DigitalProductPassport,
      version: '0.6.1',
      name: 'Digital Product Passport v0.6.1',
      slug: 'dpp/0.6.1',
      templateDir: 'digital_product_passport',
    },
    {
      id: 'a1b2c3d4-0002-4000-8000-000000000002',
      templateId: 'b2c3d4e5-0002-4000-8000-000000000002',
      credentialType: CredentialType.DigitalConformityCredential,
      version: '0.6.1',
      name: 'Digital Conformity Credential v0.6.1',
      slug: 'dcc/0.6.1',
      templateDir: 'digital_conformity_credential',
    },
    {
      id: 'a1b2c3d4-0003-4000-8000-000000000003',
      templateId: 'b2c3d4e5-0003-4000-8000-000000000003',
      credentialType: CredentialType.DigitalFacilityRecord,
      version: '0.6.1',
      name: 'Digital Facility Record v0.6.1',
      slug: 'dfr/0.6.1',
      templateDir: 'digital_facility_record',
    },
    {
      id: 'a1b2c3d4-0004-4000-8000-000000000004',
      templateId: 'b2c3d4e5-0004-4000-8000-000000000004',
      credentialType: CredentialType.DigitalIdentityAnchor,
      version: '0.6.1',
      name: 'Digital Identity Anchor v0.6.1',
      slug: 'dia/0.6.1',
      templateDir: 'digital_identity_anchor',
    },
    {
      id: 'a1b2c3d4-0005-4000-8000-000000000005',
      templateId: 'b2c3d4e5-0005-4000-8000-000000000005',
      credentialType: CredentialType.DigitalTraceabilityEvent,
      version: '0.6.1',
      name: 'Digital Traceability Event v0.6.1',
      slug: 'dte/0.6.1',
      templateDir: 'digital_traceability_event',
    },
  ];

  for (const dm of coreDataModels) {
    const exists = await prisma.dataModel.findUnique({ where: { id: dm.id } });
    if (exists) {
      logger.info({ dataModelId: dm.id, credentialType: dm.credentialType }, 'Data model already exists, skipping');
      continue;
    }

    await prisma.dataModel.create({
      data: {
        id: dm.id,
        tenantId: SYSTEM_TENANT_ID,
        name: dm.name,
        credentialType: dm.credentialType,
        version: dm.version,
        isExtension: false,
        schemaUrl: `${UNTP_BASE}/${dm.slug}/schema.json`,
        contextUrl: `${UNTP_BASE}/${dm.slug}/`,
      },
    });

    logger.info({ dataModelId: dm.id, credentialType: dm.credentialType }, 'Data model created');
  }

  // ── Seed default render templates ───────────────────────────────────────────
  // Upload .hbs templates to the storage service and record the returned URIs.
  // Requires the storage service to be available (skipped otherwise).

  let templatesSeeded = false;
  if (storageSeeded) {
    try {
      const { storageServiceUrl } = getStorageConfig();
      const storageApiKey = process.env.UNCEFACT_STORAGE_API_KEY;
      const storageBaseUrl = new URL(storageServiceUrl).origin;
      const storageHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (storageApiKey) {
        storageHeaders['X-API-Key'] = storageApiKey;
      }

      const TEMPLATES_DIR = path.resolve(__dirname, '../src/templates/v0.6.0');

      for (const dm of coreDataModels) {
        const exists = await prisma.renderTemplate.findUnique({ where: { id: dm.templateId } });
        if (exists) {
          logger.info(
            { templateId: dm.templateId, credentialType: dm.credentialType },
            'Template already exists, skipping',
          );
          continue;
        }

        const templatePath = path.join(TEMPLATES_DIR, dm.templateDir, 'template.hbs');
        if (!fs.existsSync(templatePath)) {
          logger.warn({ templatePath, credentialType: dm.credentialType }, 'Template file not found, skipping');
          continue;
        }

        const templateContent = fs.readFileSync(templatePath, 'utf-8');
        const hash = crypto.createHash('sha256').update(templateContent).digest('hex');

        // Upload to the storage service public bucket
        const uploadUrl = `${storageBaseUrl}/api/3.0.0/public`;
        const response = await fetch(uploadUrl, {
          method: 'POST',
          headers: storageHeaders,
          body: JSON.stringify({ data: templateContent, bucket: 'render-templates' }),
        });

        if (!response.ok) {
          logger.warn(
            { httpStatus: response.status, credentialType: dm.credentialType },
            'Failed to upload template to storage, skipping',
          );
          continue;
        }

        const result: unknown = await response.json();
        if (
          typeof result !== 'object' ||
          result === null ||
          typeof (result as Record<string, unknown>).uri !== 'string'
        ) {
          logger.warn(
            { credentialType: dm.credentialType, responseBody: result },
            'Storage service returned unexpected response shape, skipping template',
          );
          continue;
        }
        const { uri } = result as { uri: string };

        await prisma.renderTemplate.create({
          data: {
            id: dm.templateId,
            tenantId: SYSTEM_TENANT_ID,
            dataModelId: dm.id,
            name: `${dm.name} Default Template`,
            storageUrl: uri,
            hash,
            isPrimary: true,
          },
        });

        logger.info(
          { templateId: dm.templateId, uri, credentialType: dm.credentialType },
          'Template uploaded and seeded',
        );
      }
      templatesSeeded = true;
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : error },
        'Skipping render template seed: storage service not available',
      );
    }
  } else {
    logger.warn('Skipping render template seed: storage service was not seeded');
  }

  logger.info(
    'Seed complete: system tenant, default DID, DID service instance, ' +
      'registrars, schemes, qualifiers, data models' +
      (templatesSeeded ? ', render templates' : '') +
      (idrSeeded ? ', IDR service instance' : '') +
      (storageSeeded ? ', storage service instance' : '') +
      (vcSeeded ? ', VC service instance' : '') +
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
