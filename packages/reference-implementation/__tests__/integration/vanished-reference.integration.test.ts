import { AdapterType, Prisma, RecordSource, ServiceType } from '../../src/lib/prisma/generated/index.js';
import { NotFoundError, ServiceInstanceNotFoundError } from '../../src/lib/api/errors';
import { createDataModel } from '../../src/lib/prisma/repositories/data-model.repository';
import { createDid } from '../../src/lib/prisma/repositories/did.repository';
import { createIdentifier } from '../../src/lib/prisma/repositories/identifier.repository';
import { prisma } from '../../src/lib/prisma/prisma';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { seedSystemTenant } from './fixtures';

const TENANT_ID = 'ctestvanishedtenant0000001';
const OTHER_TENANT_ID = 'ctestvanishedtenant0000002';
const REGISTRAR_ID = 'ctestvanishedregistrar0001';
const SCHEME_ID = 'ctestvanishedscheme000001';
const PARENT_DATA_MODEL_ID = 'ctestvanishedparentmodel01';
const SERVICE_INSTANCE_ID = 'ctestvanishedservice0001';

const writer = createRigClient();
const concurrent = createRigClient();

type ParentModel = 'identifierScheme' | 'dataModel';
type FindFirstDelegate = {
  findFirst: (...args: never[]) => Promise<unknown>;
};

beforeEach(async () => {
  await truncateApplicationTables(writer);
  await seedSystemTenant(writer);
  await writer.tenant.create({ data: { id: TENANT_ID, name: 'Vanished reference tenant' } });
  await writer.tenant.create({ data: { id: OTHER_TENANT_ID, name: 'Other tenant' } });
});

afterAll(async () => {
  await writer.$disconnect();
  await concurrent.$disconnect();
});

/**
 * Pauses a real repository transaction after its parent pre-check. The second
 * Prisma client then deletes that parent and commits before the repository
 * write continues, so the write reaches PostgreSQL with a real missing FK.
 */
async function runAfterParentPrecheck<T>(
  model: ParentModel,
  deleteParent: () => Promise<void>,
  operation: () => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const releaseWrite = new Promise<void>((resolve) => {
    release = resolve;
  });
  let signalPrecheck!: () => void;
  const precheckReached = new Promise<void>((resolve) => {
    signalPrecheck = resolve;
  });

  const originalTransaction = prisma.$transaction.bind(prisma);
  const transactionSpy = jest.spyOn(prisma, '$transaction');
  transactionSpy.mockImplementation(((callback: unknown) => {
    if (typeof callback !== 'function') {
      throw new Error('vanished-reference race requires an interactive transaction');
    }
    const transactionCallback = callback as (tx: Prisma.TransactionClient) => Promise<unknown>;
    return originalTransaction(async (tx) => {
      const delegate = (tx as unknown as Record<ParentModel, FindFirstDelegate>)[model];
      const pausedDelegate = new Proxy(delegate, {
        get(target, property, receiver) {
          if (property !== 'findFirst') return Reflect.get(target, property, receiver);
          return async (...args: never[]) => {
            const result = await target.findFirst(...args);
            if (result === null) {
              throw new Error(`${model} pre-check did not find its fixture`);
            }
            signalPrecheck();
            await releaseWrite;
            return result;
          };
        },
      });
      const pausedTransaction = new Proxy(tx, {
        get(target, property, receiver) {
          if (property === model) return pausedDelegate;
          return Reflect.get(target, property, receiver);
        },
      });
      return transactionCallback(pausedTransaction);
    });
  }) as never);

  try {
    const result = operation();
    await precheckReached;
    await deleteParent();
    release();
    return await result;
  } finally {
    release();
    transactionSpy.mockRestore();
  }
}

describe('vanished references against PostgreSQL', () => {
  it('maps a scheme FK race to the scheme pre-check NotFoundError', async () => {
    await writer.registrar.create({
      data: {
        id: REGISTRAR_ID,
        tenantId: TENANT_ID,
        name: 'Vanished reference registrar',
        namespace: 'vanished',
        source: RecordSource.USER,
      },
    });
    await writer.identifierScheme.create({
      data: {
        id: SCHEME_ID,
        tenantId: TENANT_ID,
        registrarId: REGISTRAR_ID,
        name: 'Vanished reference scheme',
        primaryKey: '01',
        validationPattern: '.*',
        linkTemplate: '/{primaryKey}/{value}',
        source: RecordSource.USER,
      },
    });

    const error = await runAfterParentPrecheck(
      'identifierScheme',
      async () => {
        await concurrent.identifierScheme.delete({ where: { id: SCHEME_ID } });
        await expect(concurrent.identifierScheme.findUnique({ where: { id: SCHEME_ID } })).resolves.toBeNull();
      },
      () =>
        createIdentifier({ tenantId: TENANT_ID, schemeId: SCHEME_ID, value: 'value-after-scheme-delete' }).then(
          () => new Error('createIdentifier unexpectedly resolved'),
          (cause: unknown) => cause,
        ),
    );

    // Fails if the real P2003 falls through as a database error or is given a
    // generic message instead of the route pre-check's wording.
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toHaveProperty('message', 'Identifier scheme not found');
  });

  it('maps a parent data-model FK race to the parent pre-check NotFoundError', async () => {
    await writer.dataModel.create({
      data: {
        id: PARENT_DATA_MODEL_ID,
        tenantId: TENANT_ID,
        name: 'Vanished reference parent',
        credentialType: 'DigitalProductPassport',
        version: '0.6.1',
        schemaUrl: 'https://example.test/schema.json',
        contextUrl: 'https://example.test/context.jsonld',
        isExtension: false,
        source: RecordSource.USER,
      },
    });

    const error = await runAfterParentPrecheck(
      'dataModel',
      async () => {
        await concurrent.dataModel.delete({ where: { id: PARENT_DATA_MODEL_ID } });
        await expect(concurrent.dataModel.findUnique({ where: { id: PARENT_DATA_MODEL_ID } })).resolves.toBeNull();
      },
      () =>
        createDataModel(TENANT_ID, {
          name: 'Extension after parent delete',
          credentialType: 'DigitalProductPassport',
          version: '0.6.1',
          schemaUrl: 'https://example.test/extension-schema.json',
          contextUrl: 'https://example.test/extension-context.jsonld',
          isExtension: true,
          parentConfigId: PARENT_DATA_MODEL_ID,
        }).then(
          () => new Error('createDataModel unexpectedly resolved'),
          (cause: unknown) => cause,
        ),
    );

    // Fails if parentConfigId is mapped to a generic database error or the
    // caller is told that the new extension itself was not found.
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toHaveProperty('message', 'Parent data model configuration not found');
  });

  it('maps a caller-supplied service-instance FK failure to ServiceInstanceNotFoundError', async () => {
    await writer.serviceInstance.create({
      data: {
        id: SERVICE_INSTANCE_ID,
        tenantId: TENANT_ID,
        serviceType: ServiceType.VC,
        adapterType: AdapterType.VCKIT,
        name: 'Vanished reference service',
        config: '{}',
      },
    });
    await writer.serviceInstance.findUniqueOrThrow({ where: { id: SERVICE_INSTANCE_ID } });
    await concurrent.serviceInstance.delete({ where: { id: SERVICE_INSTANCE_ID } });
    await expect(concurrent.serviceInstance.findUnique({ where: { id: SERVICE_INSTANCE_ID } })).resolves.toBeNull();

    const error = await createDid(
      {
        tenantId: TENANT_ID,
        did: 'did:web:vanished-service.example',
        type: 'MANAGED',
        keyId: 'key-vanished-service',
        serviceInstanceId: SERVICE_INSTANCE_ID,
      },
      { callerSuppliedServiceInstanceId: SERVICE_INSTANCE_ID },
    ).then(
      () => new Error('createDid unexpectedly resolved'),
      (cause: unknown) => cause,
    );

    // Fails if the real P2003 is returned directly, sanitised, or attributed
    // to a different resource rather than the caller's vanished id.
    expect(error).toBeInstanceOf(ServiceInstanceNotFoundError);
    expect(error).toHaveProperty('message', `Service instance not found: ${SERVICE_INSTANCE_ID}`);
  });

  it('rethrows a real tenant FK failure instead of blaming a caller service instance', async () => {
    const survivingServiceId = 'ctestvanishedservice0002';
    await writer.serviceInstance.create({
      data: {
        id: survivingServiceId,
        tenantId: OTHER_TENANT_ID,
        serviceType: ServiceType.VC,
        adapterType: AdapterType.VCKIT,
        name: 'Surviving other-tenant service',
        config: '{}',
      },
    });
    await writer.tenant.findUniqueOrThrow({ where: { id: TENANT_ID } });
    await concurrent.tenant.delete({ where: { id: TENANT_ID } });
    await expect(concurrent.tenant.findUnique({ where: { id: TENANT_ID } })).resolves.toBeNull();

    const error = await createDid({
      tenantId: TENANT_ID,
      did: 'did:web:vanished-tenant.example',
      type: 'MANAGED',
      keyId: 'key-vanished-tenant',
      serviceInstanceId: survivingServiceId,
    }).then(
      () => new Error('createDid unexpectedly resolved'),
      (cause: unknown) => cause,
    );

    // Fails if isForeignKeyViolationOn matches any P2003 indiscriminately and
    // reports a service instance id the caller did not supply.
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error).toHaveProperty('code', 'P2003');
    expect(error).toHaveProperty('message', expect.stringContaining('tenantId'));
    expect((error as Error).message).not.toContain(survivingServiceId);
  });
});
