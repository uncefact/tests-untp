import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import {
  DidMethod,
  DidStatus,
  DidType,
  PrismaClient,
  RenderMethodType,
  ServiceType as PrismaServiceType,
  AdapterType as PrismaAdapterType,
} from '../src/lib/prisma/generated';
import { AesGcmEncryptionAdapter, didAdapterRegistry } from '@uncefact/untp-ri-services/server';
import {
  EncryptionAlgorithm,
  createLogger,
  DidConflictError,
  parseDidMethod,
  DidType as ServiceDidType,
  DidMethod as ServiceDidMethod,
  adapterRegistry,
  ServiceType,
} from '@uncefact/untp-ri-services';
import { getDidConfig } from '../src/lib/config/did.config';
import {
  SYSTEM_TENANT_ID,
  SYSTEM_IDR_SERVICE_ID,
  SYSTEM_STORAGE_SERVICE_ID,
  SYSTEM_VC_SERVICE_ID,
  SYSTEM_DID_ID,
} from '../src/lib/prisma/constants';

const logger = createLogger().child({ module: 'prisma-seed' });

// Load .env before accessing config (seed runs outside Next.js)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Construct RI_DATABASE_URL from individual env vars (same as prisma.config.ts)
// In Docker, these come from docker-compose; locally, from .env
const { RI_POSTGRES_USER, RI_POSTGRES_PASSWORD, RI_POSTGRES_DB, RI_POSTGRES_HOST, RI_POSTGRES_PORT } = process.env;
if (RI_POSTGRES_USER && RI_POSTGRES_PASSWORD && RI_POSTGRES_DB && RI_POSTGRES_HOST && RI_POSTGRES_PORT) {
  process.env.RI_DATABASE_URL = `postgresql://${RI_POSTGRES_USER}:${RI_POSTGRES_PASSWORD}@${RI_POSTGRES_HOST}:${RI_POSTGRES_PORT}/${RI_POSTGRES_DB}?schema=public`;
}

const prisma = new PrismaClient();

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

  // Read DID configuration (DID creation happens after VC service is available)
  let didConfig: { defaultDid: string; defaultKeyId?: string } | null = null;
  try {
    didConfig = getDidConfig();
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : error },
      'DID configuration not available; skipping default DID seed',
    );
  }

  // ── Seed service instances (requires SERVICE_ENCRYPTION_KEY) ────────────────

  const ENCRYPTION_KEY = process.env.SERVICE_ENCRYPTION_KEY;
  let encryptionService: AesGcmEncryptionAdapter | null = null;
  if (ENCRYPTION_KEY) {
    encryptionService = new AesGcmEncryptionAdapter(ENCRYPTION_KEY, logger);
  } else {
    logger.warn(
      'SERVICE_ENCRYPTION_KEY not set; skipping service instance seeds (IDR, storage, VC). ' +
        'These can be configured later via the application UI.',
    );
  }

  // ── Seed system Pyx IDR service instance ────────────────────────────────────

  let idrAdapterType: string | null = null;
  let idrConfig: unknown = null;
  let idrSeeded = false;
  if (encryptionService) {
    try {
      const idrAdapters = adapterRegistry[ServiceType.IDR];
      const permittedIdrTypes = Object.keys(idrAdapters) as Array<keyof typeof idrAdapters>;
      const resolvedIdrAdapterType = (process.env.SYSTEM_IDR_ADAPTER_TYPE as keyof typeof idrAdapters) || 'PYX_IDR';
      idrAdapterType = resolvedIdrAdapterType;
      const idrRegistryEntry = idrAdapters[resolvedIdrAdapterType];
      if (!idrRegistryEntry) {
        throw new Error(
          `Unknown IDR adapter type: "${idrAdapterType}". Permitted types: ${permittedIdrTypes.join(', ')}`,
        );
      }
      idrConfig = idrRegistryEntry.configSchema.parse({
        baseUrl: process.env.SYSTEM_IDR_BASE_URL,
        apiKey: process.env.SYSTEM_IDR_API_KEY,
        apiVersion: process.env.SYSTEM_IDR_API_VERSION || undefined,
        defaultLinkType: process.env.SYSTEM_IDR_DEFAULT_LINK_TYPE,
        defaultMimeType: process.env.SYSTEM_IDR_DEFAULT_MIME_TYPE,
        defaultIanaLanguage: process.env.SYSTEM_IDR_DEFAULT_LANGUAGE,
        defaultContext: process.env.SYSTEM_IDR_DEFAULT_CONTEXT,
        defaultFwqs: process.env.SYSTEM_IDR_DEFAULT_FWQS === 'true',
      });
      const idrServiceConfig = JSON.stringify(idrConfig);
      const encryptedIdrConfig = JSON.stringify(
        encryptionService.encrypt(idrServiceConfig, EncryptionAlgorithm.AES_256_GCM),
      );

      await prisma.serviceInstance.upsert({
        where: { id: SYSTEM_IDR_SERVICE_ID },
        update: { config: encryptedIdrConfig },
        create: {
          id: SYSTEM_IDR_SERVICE_ID,
          tenantId: SYSTEM_TENANT_ID,
          serviceType: PrismaServiceType.IDR,
          adapterType: idrAdapterType as unknown as PrismaAdapterType,
          name: process.env.SYSTEM_IDR_SERVICE_NAME || 'System Default IDR',
          description:
            process.env.SYSTEM_IDR_SERVICE_DESCRIPTION || 'System-wide default Identity Resolver service instance',
          config: encryptedIdrConfig,
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
  }

  // ── Seed system UNCEFACT storage service instance ───────────────────────────

  let storageSeeded = false;
  let storageRegistryEntry:
    | (typeof adapterRegistry)[typeof ServiceType.STORAGE][keyof (typeof adapterRegistry)[typeof ServiceType.STORAGE]]
    | null = null;
  let storageConfig: unknown = null;
  if (encryptionService) {
    try {
      const storageAdapters = adapterRegistry[ServiceType.STORAGE];
      const permittedStorageTypes = Object.keys(storageAdapters) as Array<keyof typeof storageAdapters>;
      const storageAdapterType =
        (process.env.SYSTEM_STORAGE_ADAPTER_TYPE as keyof typeof storageAdapters) || 'UNCEFACT_STORAGE';
      const resolvedStorageEntry = storageAdapters[storageAdapterType];
      if (!resolvedStorageEntry) {
        throw new Error(
          `Unknown storage adapter type: "${storageAdapterType}". Permitted types: ${permittedStorageTypes.join(', ')}`,
        );
      }
      const parsedStorageConfig = resolvedStorageEntry.configSchema.parse({
        baseUrl: process.env.SYSTEM_STORAGE_BASE_URL,
        apiKey: process.env.SYSTEM_STORAGE_API_KEY || undefined,
        apiVersion: process.env.SYSTEM_STORAGE_API_VERSION || undefined,
        publicBucket: process.env.SYSTEM_STORAGE_PUBLIC_BUCKET || undefined,
        privateBucket: process.env.SYSTEM_STORAGE_PRIVATE_BUCKET || undefined,
      });
      storageConfig = parsedStorageConfig;
      storageRegistryEntry = resolvedStorageEntry;
      const storageServiceConfig = JSON.stringify(parsedStorageConfig);
      const encryptedStorageConfig = JSON.stringify(
        encryptionService.encrypt(storageServiceConfig, EncryptionAlgorithm.AES_256_GCM),
      );

      await prisma.serviceInstance.upsert({
        where: { id: SYSTEM_STORAGE_SERVICE_ID },
        update: { config: encryptedStorageConfig },
        create: {
          id: SYSTEM_STORAGE_SERVICE_ID,
          tenantId: SYSTEM_TENANT_ID,
          serviceType: PrismaServiceType.STORAGE,
          adapterType: storageAdapterType as unknown as PrismaAdapterType,
          name: process.env.SYSTEM_STORAGE_SERVICE_NAME || 'System Default Storage',
          description: process.env.SYSTEM_STORAGE_SERVICE_DESCRIPTION || 'System-wide default storage service instance',
          config: encryptedStorageConfig,
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
  }

  // ── Seed system VC service instance ───────────────────────────────────────
  let vcSeeded = false;
  let vcAdapterType: string | null = null;
  let vcConfig: unknown = null;
  if (encryptionService) {
    try {
      const vcAdapters = adapterRegistry[ServiceType.VC];
      const permittedVcTypes = Object.keys(vcAdapters) as Array<keyof typeof vcAdapters>;
      const resolvedVcAdapterType = (process.env.SYSTEM_VC_ADAPTER_TYPE as keyof typeof vcAdapters) || 'VCKIT';
      const vcRegistryEntry = vcAdapters[resolvedVcAdapterType];
      if (!vcRegistryEntry) {
        throw new Error(
          `Unknown VC adapter type: "${resolvedVcAdapterType}". Permitted types: ${permittedVcTypes.join(', ')}`,
        );
      }
      vcConfig = vcRegistryEntry.configSchema.parse({
        baseUrl: process.env.SYSTEM_VC_BASE_URL,
        apiKey: process.env.SYSTEM_VC_API_KEY,
        apiVersion: process.env.SYSTEM_VC_API_VERSION || undefined,
      });
      vcAdapterType = resolvedVcAdapterType;
      const vcServiceConfig = JSON.stringify(vcConfig);
      const encryptedVcConfig = JSON.stringify(
        encryptionService.encrypt(vcServiceConfig, EncryptionAlgorithm.AES_256_GCM),
      );

      await prisma.serviceInstance.upsert({
        where: { id: SYSTEM_VC_SERVICE_ID },
        update: { config: encryptedVcConfig },
        create: {
          id: SYSTEM_VC_SERVICE_ID,
          tenantId: SYSTEM_TENANT_ID,
          serviceType: PrismaServiceType.VC,
          adapterType: resolvedVcAdapterType as unknown as PrismaAdapterType,
          name: process.env.SYSTEM_VC_SERVICE_NAME || 'System Default VC',
          description:
            process.env.SYSTEM_VC_SERVICE_DESCRIPTION || 'System-wide default verifiable credential service instance',
          config: encryptedVcConfig,
          isPrimary: true,
        },
      });
      vcSeeded = true;
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : error },
        'Skipping VC service instance seed: VC configuration not available',
      );
    }
  }

  // ── Seed system default DID via VC service ─────────────────────────────────
  // Uses the DID adapter registry to resolve the correct DID adapter for the
  // seeded VC service, creates the DID (if it doesn't already exist), resolves
  // the key ID from the DID document, and records it in the database.

  let defaultDid: string | null = null;
  if (didConfig && vcSeeded && vcAdapterType && vcConfig) {
    const { defaultDid: didString, defaultKeyId: envKeyId } = didConfig;

    // 1. Validate DID format (parseDidMethod throws for invalid/unsupported methods)
    parseDidMethod(didString);

    // 2. Resolve the DID adapter from the registry using the seeded VC adapter type
    const didRegistryEntry = didAdapterRegistry[vcAdapterType as keyof typeof didAdapterRegistry];
    if (!didRegistryEntry) {
      throw new Error(
        `No DID adapter registered for VC adapter type: "${vcAdapterType}". ` +
          `Permitted types: ${Object.keys(didAdapterRegistry).join(', ')}`,
      );
    }
    const didAdapter = didRegistryEntry.factory(
      vcConfig as Parameters<typeof didRegistryEntry.factory>[0],
      logger.child({ service: 'DID - Seed' }),
    );

    // 3. Create DID via VC service (or confirm it already exists)
    // Extract alias from the DID (everything after did:web:)
    const alias = didString.replace(/^did:[^:]+:/, '');
    let resolvedKeyId: string;

    try {
      const didRecord = await didAdapter.create({
        type: ServiceDidType.SELF_MANAGED,
        method: ServiceDidMethod.DID_WEB,
        alias,
      });
      resolvedKeyId = didRecord.keyId;
      logger.info({ did: didRecord.did, keyId: resolvedKeyId }, 'DID created via VC service');
    } catch (error) {
      if (error instanceof DidConflictError) {
        // DID already exists on the upstream provider — fetch its document to resolve the key ID
        logger.warn({ did: didString }, 'DID already exists in VC service — skipping creation');
        const document = await didAdapter.getDocument(didString);
        const verificationMethods: Array<{ id: string }> = document.verificationMethod ?? [];
        if (verificationMethods.length === 0) {
          throw new Error(
            `No verification methods found in DID document for "${didString}" — ` +
              'cannot resolve key ID. Set SYSTEM_DID_KEY_ID explicitly.',
          );
        }
        resolvedKeyId = verificationMethods[0].id;
        logger.info({ did: didString, keyId: resolvedKeyId }, 'Resolved key ID from existing DID document');
      } else {
        throw error;
      }
    }

    // 4. If SYSTEM_DID_KEY_ID is set, validate it matches the resolved key
    if (envKeyId && envKeyId !== resolvedKeyId) {
      // Fetch document to check all verification methods
      const document = await didAdapter.getDocument(didString);
      const verificationMethods: Array<{ id: string }> = document.verificationMethod ?? [];
      const found = verificationMethods.some((vm) => vm.id === envKeyId || vm.id.endsWith(`#${envKeyId}`));
      if (!found) {
        throw new Error(
          `SYSTEM_DID_KEY_ID "${envKeyId}" not found in DID document for "${didString}". ` +
            `Available verification methods: ${verificationMethods.map((vm) => vm.id).join(', ') || 'none'}`,
        );
      }
      resolvedKeyId = envKeyId;
      logger.info({ did: didString, keyId: resolvedKeyId }, 'Using explicitly configured key ID');
    }

    // 5. Record DID in database
    await prisma.did.upsert({
      where: { id: SYSTEM_DID_ID },
      update: {
        did: didString,
        name: process.env.SYSTEM_DID_NAME || 'System Default DID',
        description:
          process.env.SYSTEM_DID_DESCRIPTION || 'System-wide default DID for the UNTP reference implementation',
        keyId: resolvedKeyId,
        status: DidStatus.ACTIVE,
        isDefault: true,
        serviceInstanceId: SYSTEM_VC_SERVICE_ID,
      },
      create: {
        id: SYSTEM_DID_ID,
        tenantId: SYSTEM_TENANT_ID,
        did: didString,
        type: DidType.DEFAULT,
        method: DidMethod.DID_WEB,
        name: process.env.SYSTEM_DID_NAME || 'System Default DID',
        description:
          process.env.SYSTEM_DID_DESCRIPTION || 'System-wide default DID for the UNTP reference implementation',
        keyId: resolvedKeyId,
        status: DidStatus.ACTIVE,
        isDefault: true,
        serviceInstanceId: SYSTEM_VC_SERVICE_ID,
      },
    });
    defaultDid = didString;

    logger.info({ did: didString, keyId: resolvedKeyId }, 'Default DID seeded and linked to VC service instance');
  } else if (didConfig && !vcSeeded) {
    logger.warn('Skipping default DID seed: VC service instance was not seeded (required for DID creation)');
  }

  // ── Seed core data model configs ────────────────────────────────────────────
  // Static UUIDs ensure idempotent seeding — if the record already exists, skip.

  const UNTP_BASE = 'https://test.uncefact.org/vocabulary/untp';

  const coreDataModels = [
    {
      id: 'cxuj555flzqtp4ldvklv6ya39',
      templateId: 'ctehlnyxvdpmp4kv1cxa0tj0t',
      credentialType: 'DigitalProductPassport',
      version: '0.6.0',
      name: 'Digital Product Passport v0.6.0',
      shortCode: 'dpp',
      templateDir: 'digital_product_passport',
    },
    {
      id: 'c3imzyum0txv1y9xkww88aktp',
      templateId: 'cb6ka4fhk68m1wqeitptm24z1',
      credentialType: 'DigitalConformityCredential',
      version: '0.6.0',
      name: 'Digital Conformity Credential v0.6.0',
      shortCode: 'dcc',
      templateDir: 'digital_conformity_credential',
    },
    {
      id: 'ctfgtrsuiwv1fedo9t5swxhnk',
      templateId: 'c62zomihgkn6iimbv7dzhr1fj',
      credentialType: 'DigitalFacilityRecord',
      version: '0.6.0',
      name: 'Digital Facility Record v0.6.0',
      shortCode: 'dfr',
      templateDir: 'digital_facility_record',
    },
    {
      id: 'cz9raijqcay5nzmq59geoggrk',
      templateId: 'cv2ldbzupwtbluam7nrfqqv1e',
      credentialType: 'DigitalIdentityAnchor',
      version: '0.6.0',
      name: 'Digital Identity Anchor v0.6.0',
      shortCode: 'dia',
      templateDir: 'digital_identity_anchor',
    },
    {
      id: 'crqvpwffc0k2p4bvr8za1ii6j',
      templateId: 'c1fx8t9k9p6q8wcaxib6e6id1',
      credentialType: 'DigitalTraceabilityEvent',
      version: '0.6.0',
      name: 'Digital Traceability Event v0.6.0',
      shortCode: 'dte',
      templateDir: 'digital_traceability_event',
    },
    {
      id: 'c1pxfzzkeb86jgeel7hrvmcle',
      templateId: 'co3tub0ndto2lzq9l4rsnw22y',
      credentialType: 'DigitalProductPassport',
      version: '0.6.1',
      name: 'Digital Product Passport v0.6.1',
      shortCode: 'dpp',
      templateDir: 'digital_product_passport',
    },
    {
      id: 'cttpz40pfgcfeue2wmbc3jti8',
      templateId: 'cx5qp969tkboeem04szgwyb32',
      credentialType: 'DigitalConformityCredential',
      version: '0.6.1',
      name: 'Digital Conformity Credential v0.6.1',
      shortCode: 'dcc',
      templateDir: 'digital_conformity_credential',
    },
    {
      id: 'csrtste8ai2llop7ui8u6n11l',
      templateId: 'c91eyblwyejyfoq1pfqsik0ty',
      credentialType: 'DigitalFacilityRecord',
      version: '0.6.1',
      name: 'Digital Facility Record v0.6.1',
      shortCode: 'dfr',
      templateDir: 'digital_facility_record',
    },
    {
      id: 'cn5u63huxvqgdwppebaxmqt9l',
      templateId: 'c5khe5ju6ai3ptaw55r01vayo',
      credentialType: 'DigitalIdentityAnchor',
      version: '0.6.1',
      name: 'Digital Identity Anchor v0.6.1',
      shortCode: 'dia',
      templateDir: 'digital_identity_anchor',
    },
    {
      id: 'cwb7m3k0hpz9xqft6rjn2oe4s',
      templateId: 'c8yvd2gnmr5w1kbjx4hq0zp7f',
      credentialType: 'DigitalTraceabilityEvent',
      version: '0.6.1',
      name: 'Digital Traceability Event v0.6.1',
      shortCode: 'dte',
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
        schemaUrl: `${UNTP_BASE}/${dm.shortCode}/untp-${dm.shortCode}-schema-${dm.version}.json`,
        contextUrl: `${UNTP_BASE}/${dm.shortCode}/${dm.version}/context/`,
        websiteUrl: 'https://untp.unece.org/',
      },
    });

    logger.info({ dataModelId: dm.id, credentialType: dm.credentialType }, 'Data model created');
  }

  // ── Seed default render templates ───────────────────────────────────────────
  // Upload .hbs templates to the storage service and record the returned URIs.
  // Requires the storage service to be available (skipped otherwise).

  let templatesSeeded = false;
  if (storageSeeded && storageRegistryEntry && storageConfig) {
    try {
      const storageService = storageRegistryEntry.factory(
        storageConfig as Parameters<typeof storageRegistryEntry.factory>[0],
        logger.child({ service: 'Storage - Seed' }),
      );

      const TEMPLATES_BASE = path.resolve(__dirname, '../src/templates');

      for (const dm of coreDataModels) {
        const exists = await prisma.renderTemplate.findUnique({ where: { id: dm.templateId } });
        if (exists) {
          logger.info(
            { templateId: dm.templateId, credentialType: dm.credentialType },
            'Template already exists, skipping',
          );
          continue;
        }

        const templatePath = path.join(TEMPLATES_BASE, `v${dm.version}`, dm.templateDir, 'template.hbs');
        if (!fs.existsSync(templatePath)) {
          logger.warn({ templatePath, credentialType: dm.credentialType }, 'Template file not found, skipping');
          continue;
        }

        const templateContent = fs.readFileSync(templatePath, 'utf-8');

        // Upload template to storage via the seeded storage service adapter
        const storageRecord = await storageService.storeBinary(
          templateContent,
          `${dm.shortCode}-template.hbs`,
          'text/html',
        );

        await prisma.renderTemplate.create({
          data: {
            id: dm.templateId,
            tenantId: SYSTEM_TENANT_ID,
            dataModelId: dm.id,
            name: `${dm.name} Default Template`,
            storageUrl: storageRecord.uri,
            hash: storageRecord.hash ?? crypto.createHash('sha256').update(templateContent).digest('hex'),
            isDefault: true,
            renderMethodType: RenderMethodType.RenderTemplate2024,
            inline: false,
            mediaType: 'text/html',
            storageExternalId: storageRecord.externalId,
            storageBucket: storageRecord.bucket,
            storageContentType: 'text/html',
            storageServiceInstanceId: SYSTEM_STORAGE_SERVICE_ID,
          },
        });

        logger.info(
          { templateId: dm.templateId, uri: storageRecord.uri, credentialType: dm.credentialType },
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

  // ── Run custom seed (deployer-provided data) ──────────────────────────────
  // Environment variables:
  //   SKIP_CUSTOM_SEED=true   - Skip custom seed (deployer-provided data from /app/seed/custom/)
  if (process.env.SKIP_CUSTOM_SEED !== 'true') {
    const { runCustomSeed } = await import('./custom-seed');
    const { SUPPORTED_CVC_VERSIONS, getCvcParser } = await import('@uncefact/untp-ri-services');

    await runCustomSeed({
      logger: logger.child({ module: 'custom-seed' }),
      prisma,
      systemTenantId: SYSTEM_TENANT_ID,
      customSeedDir: '/app/seed/custom',
      storageService:
        storageSeeded && storageRegistryEntry && storageConfig
          ? storageRegistryEntry.factory(
              storageConfig as Parameters<typeof storageRegistryEntry.factory>[0],
              logger.child({ service: 'Storage - Custom Seed' }),
            )
          : null,
      storageServiceInstanceId: SYSTEM_STORAGE_SERVICE_ID,
      getCvcParser,
      importCatalogue: async (input: unknown) => {
        const { importCatalogue } = await import('../src/lib/prisma/repositories/cvc.repository');
        return importCatalogue(input as Parameters<typeof importCatalogue>[0]);
      },
      supportedCvcVersions: SUPPORTED_CVC_VERSIONS,
    });
  } else {
    logger.info('Skipping custom seed (SKIP_CUSTOM_SEED is set)');
  }

  // ── Register identifier schemes with IDR service ────────────────────────────
  // In the dev environment, the RI operates the Pyx IDR — register seeded schemes.
  if (idrSeeded && idrAdapterType === 'PYX_IDR') {
    try {
      const { PyxIdentityResolverAdapter } = await import('@uncefact/untp-ri-services/server');
      const pyxAdapter = new PyxIdentityResolverAdapter(
        idrConfig as ConstructorParameters<typeof PyxIdentityResolverAdapter>[0],
        logger.child({ service: 'IDR - Seed' }),
      );

      // Fetch seeded schemes grouped by registrar namespace
      const schemes = await prisma.identifierScheme.findMany({
        where: { tenantId: SYSTEM_TENANT_ID },
        include: { registrar: true, qualifiers: { orderBy: { order: 'asc' } } },
      });

      // Group by registrar namespace
      const grouped = new Map<string, typeof schemes>();
      for (const scheme of schemes) {
        const ns = scheme.registrar.namespace;
        if (!grouped.has(ns)) grouped.set(ns, []);
        grouped.get(ns)!.push(scheme);
      }

      for (const [namespace, nsSchemes] of grouped) {
        const applicationIdentifiers = nsSchemes.flatMap((s) => {
          const primary = {
            title: s.name,
            label: s.primaryKey,
            shortcode: s.primaryKey,
            ai: s.primaryKey,
            type: 'I' as const,
            regex: s.validationPattern,
            qualifiers: s.qualifiers.map((q) => q.key),
          };
          const quals = s.qualifiers.map((q) => ({
            title: q.description,
            label: q.key,
            shortcode: q.key,
            ai: q.key,
            type: 'Q' as const,
            regex: q.validationPattern,
          }));
          return [primary, ...quals];
        });

        try {
          await pyxAdapter.registerSchemes([{ namespace, applicationIdentifiers }]);
          logger.info({ namespace, count: applicationIdentifiers.length }, 'Registered schemes with IDR');
        } catch (error) {
          const status = (error as { context?: { httpStatus?: number } })?.context?.httpStatus;
          const message = error instanceof Error ? error.message : String(error);

          if (status === 409) {
            logger.info({ namespace }, 'Schemes already registered with IDR — skipping');
          } else if (status === 400 || status === 422) {
            logger.error(
              { namespace, error: message },
              'IDR scheme registration validation error — skipping namespace',
            );
          } else {
            // Fatal: auth errors (401/403), server errors (5xx), network errors
            throw error;
          }
        }
      }

      logger.info('IDR scheme registration complete');
    } catch (error) {
      logger.error({ error: error instanceof Error ? error.message : error }, 'IDR scheme registration failed');
      throw error;
    }
  } else if (idrSeeded) {
    logger.info({ adapterType: idrAdapterType }, 'Non-Pyx IDR adapter — skipping scheme registration');
  }

  logger.info(
    'Seed complete: system tenant' +
      (defaultDid ? ', default DID' : '') +
      ', data models' +
      (templatesSeeded ? ', render templates' : '') +
      ', custom seed' +
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
