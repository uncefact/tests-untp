import type {
  CredentialStatusEntry as WireCredentialStatusEntry,
  CredentialStatusObservation,
} from '@uncefact/untp-ri-services';
import { CredentialStatusCapture, LibraryRecordOrigin, VcServiceAttribution, Prisma } from '../prisma/generated';
import { resolveVcService } from '../services/resolve-vc-service';
import { prisma } from '../prisma/prisma';
import { lockLibraryRecordForUpdate } from '../prisma/repositories/library-record.repository';

export type CredentialStatusAttributionOptions = {
  tenantId: string;
  instanceId: string;
  reason: string;
  dryRun?: boolean;
  reassign?: boolean;
};

export type CredentialStatusAttributionFailure = { credentialId: string; message: string };

export type CredentialStatusAttributionResult = {
  dryRun: boolean;
  scanned: number;
  attributed: number;
  evidenceFailures: CredentialStatusAttributionFailure[];
  writeFailures: CredentialStatusAttributionFailure[];
  reports: CredentialStatusAttributionRowReport[];
};

export type CredentialStatusAttributionRowEvidence =
  | { outcome: 'agrees' }
  | { outcome: 'disagrees'; message: string }
  | { outcome: 'unavailable'; message: string };

export type CredentialStatusAttributionRowReport = {
  credentialId: string;
  attributed: boolean;
  evidence: CredentialStatusAttributionRowEvidence;
};

export type CredentialStatusAttributionEvidence =
  | { outcome: 'agree' }
  | { outcome: 'disagrees'; message: string }
  | { outcome: 'read_failed'; message: string };

type AttributionRow = {
  id: string;
  tenantId: string;
  vcServiceInstanceId: string | null;
  vcServiceAttribution: VcServiceAttribution | null;
  statusCapture: CredentialStatusCapture;
  statusEntries: Array<{
    id: string;
    statusPurpose: string;
    statusListCredential: string;
    statusListIndex: string;
    statusListVcIssuer: string;
    descriptor: unknown;
    pendingToken: string | null;
  }>;
};

/** The exact target set is shared by the scan and its conditional update. */
export function credentialStatusAttributionPredicate(
  options: Pick<CredentialStatusAttributionOptions, 'tenantId' | 'reassign'>,
): Prisma.CredentialWhereInput {
  const mode =
    options.reassign === true
      ? { vcServiceAttribution: VcServiceAttribution.OPERATOR }
      : {
          vcServiceInstanceId: null,
          OR: [{ vcServiceAttribution: null }, { vcServiceAttribution: { not: VcServiceAttribution.ISSUANCE } }],
        };
  return {
    tenantId: options.tenantId,
    origin: LibraryRecordOrigin.NATIVE,
    statusCapture: CredentialStatusCapture.CAPTURED,
    statusEntries: { none: { pendingToken: { not: null } } },
    ...mode,
  };
}

/** Checks that a provider read still addresses the stored status coordinate. */
export function assessCredentialStatusAttributionEvidence(
  entry: Pick<AttributionRow['statusEntries'][number], 'statusPurpose' | 'statusListCredential' | 'statusListIndex'>,
  observation: CredentialStatusObservation,
): CredentialStatusAttributionEvidence {
  const expected = {
    statusPurpose: entry.statusPurpose,
    statusListCredential: entry.statusListCredential,
    statusListIndex: entry.statusListIndex,
  };
  if (
    observation.statusPurpose !== expected.statusPurpose ||
    observation.statusListCredential !== expected.statusListCredential ||
    observation.statusListIndex !== expected.statusListIndex
  ) {
    return {
      outcome: 'disagrees',
      message: `Provider read disagreed with the stored coordinate for ${entry.statusPurpose}`,
    };
  }
  return { outcome: 'agree' };
}

/** Converts a failed supporting read into an actionable evidence outcome. */
export function assessCredentialStatusAttributionReadFailure(
  error: unknown,
): Extract<CredentialStatusAttributionEvidence, { outcome: 'read_failed' }> {
  return {
    outcome: 'read_failed',
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * Records an operator's historical service assertion. Reads are evidence only:
 * a provider can show that an entry is reachable, not that this instance owns
 * it, so a read failure is reported while the explicit assertion remains the
 * source of attribution.
 */
export async function attributeCredentialStatusInstance(
  options: CredentialStatusAttributionOptions,
  client: AttributionClient = prisma,
): Promise<CredentialStatusAttributionResult> {
  const result: CredentialStatusAttributionResult = {
    dryRun: options.dryRun === true,
    scanned: 0,
    attributed: 0,
    evidenceFailures: [],
    writeFailures: [],
    reports: [],
  };
  const instance = await resolveVcService(options.tenantId, options.instanceId);
  const predicate = credentialStatusAttributionPredicate(options);
  for (const row of await listRows(client, predicate)) {
    result.scanned += 1;

    const signal = AbortSignal.timeout(10_000);
    const evidenceMessages: string[] = [];
    let evidenceDisagreed = false;
    let evidenceUnavailable = false;
    for (const entry of row.statusEntries) {
      try {
        const observation = await instance.service.getCredentialStatus({
          statusListIssuer: entry.statusListVcIssuer,
          entry: entry.descriptor as WireCredentialStatusEntry,
          signal,
        });
        const evidence = assessCredentialStatusAttributionEvidence(entry, observation);
        if (evidence.outcome === 'disagrees') {
          evidenceDisagreed = true;
          evidenceMessages.push(`${entry.statusPurpose}: ${evidence.message}`);
          result.evidenceFailures.push({
            credentialId: row.id,
            message: `${entry.statusPurpose}: ${evidence.message}`,
          });
        }
      } catch (error) {
        const evidence = assessCredentialStatusAttributionReadFailure(error);
        evidenceUnavailable = true;
        evidenceMessages.push(`${entry.statusPurpose}: ${evidence.message}`);
        result.evidenceFailures.push({
          credentialId: row.id,
          message: `${entry.statusPurpose}: ${evidence.message}`,
        });
      }
    }

    const evidence: CredentialStatusAttributionRowEvidence = evidenceDisagreed
      ? { outcome: 'disagrees', message: evidenceMessages.join('; ') }
      : evidenceUnavailable
        ? { outcome: 'unavailable', message: evidenceMessages.join('; ') }
        : { outcome: 'agrees' };

    if (result.dryRun) {
      result.attributed += 1;
      result.reports.push({ credentialId: row.id, attributed: true, evidence });
      continue;
    }

    try {
      const updated = await client.$transaction(async (tx) => {
        if (!(await lockLibraryRecordForUpdate(tx, row.id, options.tenantId))) return 0;
        return (
          await tx.credential.updateMany({
            where: { ...predicate, id: row.id },
            data: {
              vcServiceInstanceId: options.instanceId,
              vcServiceAttribution: VcServiceAttribution.OPERATOR,
              vcServiceAttributedAt: new Date(),
              vcServiceAttributionReason: options.reason,
            },
          })
        ).count;
      });
      if (updated !== 1) {
        result.writeFailures.push({
          credentialId: row.id,
          message: 'The row changed before attribution was committed',
        });
      } else {
        result.attributed += 1;
        result.reports.push({ credentialId: row.id, attributed: true, evidence });
      }
    } catch (error) {
      result.writeFailures.push({ credentialId: row.id, message: String(error) });
      result.reports.push({ credentialId: row.id, attributed: false, evidence });
    }
  }
  return result;
}

async function listRows(client: AttributionClient, predicate: Prisma.CredentialWhereInput): Promise<AttributionRow[]> {
  return (await client.credential.findMany({
    where: predicate,
    select: {
      id: true,
      tenantId: true,
      vcServiceInstanceId: true,
      vcServiceAttribution: true,
      statusCapture: true,
      statusEntries: {
        select: {
          id: true,
          statusPurpose: true,
          statusListCredential: true,
          statusListIndex: true,
          statusListVcIssuer: true,
          descriptor: true,
          pendingToken: true,
        },
        orderBy: { statusPurpose: 'asc' },
      },
    },
    orderBy: { id: 'asc' },
  } as Prisma.CredentialFindManyArgs)) as AttributionRow[];
}

export type AttributionClient = {
  credential: { findMany(args: Prisma.CredentialFindManyArgs): Promise<unknown[]> };
  $transaction<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
};
