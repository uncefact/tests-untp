import { reconcileRemovals, ReconcileBlockedError } from '../custom-seed-reconcile';
import { extractSectionPresence, customSeedSchema } from '../custom-seed-schema';
import type { Prisma } from '../../src/lib/prisma/generated/index.js';

const SYSTEM_TENANT_ID = 'csystem00000000000000001';

const IDS = {
  registrar1: 'cjld2cjxh0000qzrmn831i7rn',
  registrarGone: 'cjld2cjxh0001qzrmn831i7ro',
  scheme1: 'ckabcdefghij0000klmnopqrs',
  schemeGone: 'ckabcdefghij0001klmnopqrt',
  qualifier1: 'ckabcdefghij0003klmnopqrv',
  dataModel1: 'ckabcdefghij0005klmnopqrx',
  dataModelGone: 'ckabcdefghij0007klmnopqrz',
  renderTemplate1: 'ckabcdefghij0006klmnopqry',
  parentConfig: 'ckabcdefghij0009klmnopqsb',
};

function createTx() {
  return {
    registrar: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    identifierScheme: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    schemeQualifier: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    dataModel: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    renderTemplate: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    identifier: { groupBy: jest.fn().mockResolvedValue([]) },
    conformityScheme: { count: jest.fn().mockResolvedValue(0) },
  };
}

type Tx = ReturnType<typeof createTx>;
const asTx = (tx: Tx) => tx as unknown as Prisma.TransactionClient;

/** Parse a raw manifest object the way runCustomSeed does. */
function manifestAndPresence(raw: Record<string, unknown>) {
  const presence = extractSectionPresence(raw);
  const manifest = customSeedSchema.parse(raw);
  return { manifest, presence };
}

describe('reconcileRemovals', () => {
  describe('section presence', () => {
    it('runs no removal for entity types whose key is absent from the YAML', async () => {
      const tx = createTx();
      const { manifest, presence } = manifestAndPresence({
        dataModels: [
          {
            id: IDS.dataModel1,
            name: 'DM',
            credentialType: 'X',
            version: '1.0.0',
            parentConfigId: IDS.parentConfig,
            schemaUrl: 'https://example.com/s.json',
            contextUrl: 'https://example.com/c.json',
          },
        ],
      });

      await reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID);

      // registrars / renderTemplates keys were absent: not even victim discovery runs for them.
      expect(tx.registrar.findMany).not.toHaveBeenCalled();
      expect(tx.registrar.deleteMany).not.toHaveBeenCalled();
      expect(tx.renderTemplate.deleteMany).not.toHaveBeenCalled();
      // dataModels key was present: victim discovery runs, scoped to owned rows.
      expect(tx.dataModel.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: SYSTEM_TENANT_ID,
            source: 'CUSTOM_SEED',
            id: { notIn: [IDS.dataModel1] },
          }),
        }),
      );
    });

    it('treats an explicit empty array as remove-all for that type', async () => {
      const tx = createTx();
      const { manifest, presence } = manifestAndPresence({ renderTemplates: [] });

      await reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID);

      expect(tx.renderTemplate.deleteMany).toHaveBeenCalledWith({
        where: { tenantId: SYSTEM_TENANT_ID, source: 'CUSTOM_SEED', id: { notIn: [] } },
      });
    });

    it('leaves qualifiers unmanaged when a scheme entry omits the qualifiers key', async () => {
      const tx = createTx();
      const { manifest, presence } = manifestAndPresence({
        registrars: [
          {
            id: IDS.registrar1,
            name: 'R',
            namespace: 'r',
            identifierSchemes: [
              {
                id: IDS.scheme1,
                name: 'S',
                primaryKey: '01',
                validationPattern: '.*',
                linkTemplate: '/{primaryKey}/{value}',
                // no `qualifiers` key
              },
            ],
          },
        ],
      });

      await reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID);

      expect(tx.schemeQualifier.deleteMany).not.toHaveBeenCalled();
    });

    it('removes qualifiers dropped from a scheme that declares an explicit empty qualifiers array', async () => {
      const tx = createTx();
      const { manifest, presence } = manifestAndPresence({
        registrars: [
          {
            id: IDS.registrar1,
            name: 'R',
            namespace: 'r',
            identifierSchemes: [
              {
                id: IDS.scheme1,
                name: 'S',
                primaryKey: '01',
                validationPattern: '.*',
                linkTemplate: '/{primaryKey}/{value}',
                qualifiers: [],
              },
            ],
          },
        ],
      });

      await reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID);

      expect(tx.schemeQualifier.deleteMany).toHaveBeenCalledWith({
        where: { schemeId: IDS.scheme1, source: 'CUSTOM_SEED', id: { notIn: [] } },
      });
    });
  });

  describe('non-owned-descendant blocking', () => {
    it('blocks registrar removal when a cascade would delete a scheme the manifest does not own', async () => {
      const tx = createTx();
      tx.registrar.findMany.mockResolvedValue([{ id: IDS.registrarGone, name: 'Gone' }]);
      tx.identifierScheme.findMany.mockResolvedValue([
        {
          id: IDS.schemeGone,
          name: 'Tenant scheme',
          source: 'USER',
          tenantId: 'ctenantxyz0000000000000001',
          registrarId: IDS.registrarGone,
        },
      ]);
      const { manifest, presence } = manifestAndPresence({ registrars: [] });

      await expect(reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID)).rejects.toThrow(
        ReconcileBlockedError,
      );
      expect(tx.registrar.deleteMany).not.toHaveBeenCalled();
    });

    it('blocks scheme removal when registered identifiers reference it, naming the counts', async () => {
      const tx = createTx();
      tx.registrar.findMany.mockResolvedValue([{ id: IDS.registrarGone, name: 'Gone' }]);
      tx.identifierScheme.findMany.mockResolvedValue([
        {
          id: IDS.schemeGone,
          name: 'Owned scheme',
          source: 'CUSTOM_SEED',
          tenantId: SYSTEM_TENANT_ID,
          registrarId: IDS.registrarGone,
        },
      ]);
      tx.identifier.groupBy.mockResolvedValue([{ schemeId: IDS.schemeGone, _count: { _all: 3 } }]);
      const { manifest, presence } = manifestAndPresence({ registrars: [] });

      await expect(reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID)).rejects.toThrow(
        /3 registered identifier/,
      );
      expect(tx.registrar.deleteMany).not.toHaveBeenCalled();
      expect(tx.identifierScheme.deleteMany).not.toHaveBeenCalled();
    });

    it('blocks data model removal when a non-owned render template would be cascade-deleted', async () => {
      const tx = createTx();
      tx.dataModel.findMany.mockImplementation(async (query: { where?: { parentConfigId?: unknown } }) => {
        if (query?.where && 'parentConfigId' in query.where) return [];
        return [{ id: IDS.dataModelGone, name: 'Gone DM', credentialType: 'X', version: '1.0.0' }];
      });
      tx.renderTemplate.findMany.mockResolvedValue([
        {
          id: IDS.renderTemplate1,
          name: 'Operator template',
          dataModelId: IDS.dataModelGone,
          tenantId: SYSTEM_TENANT_ID,
        },
      ]);
      const { manifest, presence } = manifestAndPresence({ dataModels: [] });

      await expect(reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID)).rejects.toThrow(
        ReconcileBlockedError,
      );
      expect(tx.dataModel.deleteMany).not.toHaveBeenCalled();
    });

    it('blocks data model removal when a non-owned extension would be cascade-deleted', async () => {
      const tx = createTx();
      tx.dataModel.findMany.mockImplementation(async (query: { where?: { parentConfigId?: unknown } }) => {
        if (query?.where && 'parentConfigId' in query.where) {
          return [{ id: IDS.dataModel1, name: 'Tenant extension', parentConfigId: IDS.dataModelGone }];
        }
        return [{ id: IDS.dataModelGone, name: 'Gone DM', credentialType: 'X', version: '1.0.0' }];
      });
      const { manifest, presence } = manifestAndPresence({ dataModels: [] });

      await expect(reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID)).rejects.toThrow(
        ReconcileBlockedError,
      );
      expect(tx.dataModel.deleteMany).not.toHaveBeenCalled();
    });

    it('blocks removal of a ConformityScheme schema binding that seeded schemes still depend on', async () => {
      const tx = createTx();
      tx.dataModel.findMany.mockImplementation(async (query: { where?: { parentConfigId?: unknown } }) => {
        if (query?.where && 'parentConfigId' in query.where) return [];
        return [{ id: IDS.dataModelGone, name: 'CS binding', credentialType: 'ConformityScheme', version: '0.7.0' }];
      });
      tx.conformityScheme.count.mockResolvedValue(2);
      const { manifest, presence } = manifestAndPresence({ dataModels: [] });

      await expect(reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID)).rejects.toThrow(
        /2 seeded conformity scheme/,
      );
      expect(tx.dataModel.deleteMany).not.toHaveBeenCalled();
    });

    it('blocks scheme removal when a non-owned qualifier sits under it', async () => {
      const tx = createTx();
      tx.registrar.findMany.mockResolvedValue([{ id: IDS.registrarGone, name: 'Gone' }]);
      tx.identifierScheme.findMany.mockResolvedValue([
        {
          id: IDS.schemeGone,
          name: 'Owned scheme',
          source: 'CUSTOM_SEED',
          tenantId: SYSTEM_TENANT_ID,
          registrarId: IDS.registrarGone,
        },
      ]);
      tx.schemeQualifier.findMany.mockResolvedValue([{ id: IDS.qualifier1, key: '10', schemeId: IDS.schemeGone }]);
      const { manifest, presence } = manifestAndPresence({ registrars: [] });

      await expect(reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID)).rejects.toThrow(
        ReconcileBlockedError,
      );
    });
  });

  describe('deletion', () => {
    it('deletes a scheme dropped from a retained registrar (direct victim path)', async () => {
      const tx = createTx();
      tx.identifierScheme.findMany.mockImplementation(async (query: { where?: { registrarId?: unknown } }) => {
        // Direct-victim discovery for a declared registrar (registrarId is a plain string).
        if (typeof query?.where?.registrarId === 'string') {
          return [{ id: IDS.schemeGone }];
        }
        return [];
      });
      const { manifest, presence } = manifestAndPresence({
        registrars: [{ id: IDS.registrar1, name: 'R', namespace: 'r', identifierSchemes: [] }],
      });

      const summary = await reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID);

      expect(tx.identifierScheme.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [IDS.schemeGone] } } });
      expect(summary.identifierSchemes).toBe(0); // count comes from deleteMany result (mocked 0)
    });

    it('deletes owned victims child-before-parent when nothing blocks', async () => {
      const tx = createTx();
      const order: string[] = [];
      tx.registrar.findMany.mockResolvedValue([{ id: IDS.registrarGone, name: 'Gone' }]);
      tx.identifierScheme.findMany.mockImplementation(async (query: { where?: { registrarId?: unknown } }) => {
        // Cascade discovery for removed registrars returns an owned scheme.
        if (query?.where && typeof query.where.registrarId === 'object' && query.where.registrarId !== null) {
          return [
            {
              id: IDS.schemeGone,
              name: 'Owned scheme',
              source: 'CUSTOM_SEED',
              tenantId: SYSTEM_TENANT_ID,
              registrarId: IDS.registrarGone,
            },
          ];
        }
        return [];
      });
      tx.registrar.deleteMany.mockImplementation(async () => {
        order.push('registrar');
        return { count: 1 };
      });
      tx.renderTemplate.deleteMany.mockImplementation(async () => {
        order.push('renderTemplate');
        return { count: 1 };
      });
      tx.dataModel.deleteMany.mockImplementation(async () => {
        order.push('dataModel');
        return { count: 0 };
      });
      const { manifest, presence } = manifestAndPresence({ registrars: [], renderTemplates: [], dataModels: [] });
      // dataModels: [] with no owned victims → dataModel.deleteMany is not called.
      tx.dataModel.findMany.mockResolvedValue([]);

      const summary = await reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID);

      expect(summary.registrars).toBe(1);
      expect(summary.renderTemplates).toBe(1);
      expect(order).toEqual(['registrar', 'renderTemplate']);
    });

    it('returns a zero summary and issues no deletes on a manifest matching the database', async () => {
      const tx = createTx();
      const { manifest, presence } = manifestAndPresence({
        registrars: [{ id: IDS.registrar1, name: 'R', namespace: 'r' }],
      });

      const summary = await reconcileRemovals(asTx(tx), manifest, presence, SYSTEM_TENANT_ID);

      expect(summary).toEqual({
        qualifiers: 0,
        identifierSchemes: 0,
        registrars: 0,
        renderTemplates: 0,
        dataModels: 0,
      });
      expect(tx.registrar.deleteMany).not.toHaveBeenCalled();
      expect(tx.identifierScheme.deleteMany).not.toHaveBeenCalled();
    });
  });
});
