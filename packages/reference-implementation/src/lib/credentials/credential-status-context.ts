import { z } from 'zod';
import {
  parseCredentialStatusEntry,
  type IVerifiableCredentialService,
  type CredentialStatusObservation,
} from '@uncefact/untp-ri-services';
import { canonicalJson } from '@uncefact/untp-utils/common';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors';
import { parseIfVersion } from '@/lib/api/if-version';
import { prisma } from '@/lib/prisma/prisma';
import type { CredentialStatusEntry, Prisma } from '@/lib/prisma/generated';
import {
  lockStatusServiceInstance,
  readPendingToken,
} from '@/lib/prisma/repositories/credential-status-entry.repository';
import { resolveServiceInstance } from '@/lib/services/resolve-service';
import { CredentialStatusError, statusReadFailure } from './credential-status-error';

/** Reads only tenant-owned records, including the origin needed to refuse external management. */
export async function loadStatusRecord(recordId: string, tenantId: string, client: Prisma.TransactionClient = prisma) {
  const record = recordId.includes('\0')
    ? null
    : await client.libraryRecord.findFirst({
        where: { id: recordId, tenantId },
        include: { credential: { include: { statusEntries: { orderBy: [{ statusPurpose: 'asc' }, { id: 'asc' }] } } } },
      });
  if (!record) throw new NotFoundError('No such credential record.', 'NOT_FOUND');
  if (record.origin !== 'NATIVE')
    throw new ForbiddenError(
      'External credential status is managed by its issuer.',
      'EXTERNAL_CREDENTIAL_STATUS_NOT_MANAGEABLE',
    );
  if (!record.credential)
    throw new CredentialStatusError(
      'RECORD_UNREADABLE',
      'The native credential record cannot be read. Contact the operator.',
      500,
    );
  return record.credential;
}

export type StatusRecord = Awaited<ReturnType<typeof loadStatusRecord>>;

/** Capture and entry selection precede transition policy and version validation (ADR-058). */
export function selectStatusEntry(record: StatusRecord, purpose: string): CredentialStatusEntry {
  if (record.statusCapture !== 'CAPTURED') {
    throw new ConflictError(
      'Status metadata is unavailable. Ask the operator to run pnpm backfill:credential-status-entries, using --retry-failed for a retryable capture failure.',
      'STATUS_METADATA_UNAVAILABLE',
    );
  }
  const entry = record.statusEntries.find((candidate) => candidate.statusPurpose === purpose);
  if (!entry)
    throw new NotFoundError(`The credential has no status entry for purpose "${purpose}".`, 'STATUS_ENTRY_NOT_FOUND');
  return entry;
}

export function requireStatusVersion(entry: CredentialStatusEntry, raw: string | null): number {
  const version = parseIfVersion(raw);
  if (entry.version !== version) throw new ConflictError('The supplied If-Version is stale.', 'VERSION_CONFLICT');
  return version;
}

export function requireStatusAttribution(record: StatusRecord): string {
  if (!record.vcServiceInstanceId)
    throw new ConflictError(
      'The issuing service is not attributed. Ask the operator to run pnpm backfill:credential-status-attribution.',
      'STATUS_METADATA_UNAVAILABLE',
    );
  return record.vcServiceInstanceId;
}

/** Uses the canonical stored index even when the original descriptor carried a numeric index. */
export function managementEntry(entry: CredentialStatusEntry) {
  try {
    const descriptor = entry.descriptor;
    if (descriptor === null || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
      throw new CredentialStatusError(
        'RECORD_UNREADABLE',
        'The stored status descriptor is invalid. Contact the operator.',
        500,
      );
    }
    return parseCredentialStatusEntry(
      {
        ...descriptor,
        type: entry.type,
        statusPurpose: entry.statusPurpose,
        statusListCredential: entry.statusListCredential,
        statusListIndex: entry.statusListIndex,
      },
      { source: 'input' },
    );
  } catch (error) {
    throw statusReadFailure(error);
  }
}

export type StatusProvider = { service: IVerifiableCredentialService; instanceId: string; digest: string };

export type ApplicationClock = () => Date;

export function applicationObservationAt(now?: ApplicationClock): string {
  return (now ?? (() => new Date(Date.now())))().toISOString();
}

/** Hashes validated plaintext, so re-encryption alone does not change provider identity. */
export async function statusConfigDigest(config: unknown): Promise<string> {
  return (
    await MultibaseDigest.fromData(Buffer.from(canonicalJson(config)), { algorithm: 'sha2-256', base: 'base58btc' })
  ).toString();
}

/** Callers lock the library parent first. No parent is acquired under this instance lock. */
export async function lockStatusProvider(
  tx: Prisma.TransactionClient,
  instanceId: string,
  tenantId: string,
): Promise<StatusProvider> {
  if (!(await lockStatusServiceInstance(tx, instanceId, tenantId))) {
    throw new CredentialStatusError(
      'VC_SERVICE_UNAVAILABLE',
      'The attributed status service is missing or unavailable. Contact the operator.',
      503,
    );
  }
  const instance = await tx.serviceInstance.findUniqueOrThrow({ where: { id: instanceId } });
  if (instance.serviceType !== 'VC')
    throw new CredentialStatusError(
      'VC_SERVICE_UNAVAILABLE',
      'The attributed service cannot manage credential status. Contact the operator.',
      503,
    );
  try {
    const resolved = resolveServiceInstance<IVerifiableCredentialService>(instance, 'VC');
    return { service: resolved.service, instanceId, digest: await statusConfigDigest(resolved.config) };
  } catch (error) {
    throw new CredentialStatusError(
      'VC_SERVICE_UNAVAILABLE',
      'The attributed status service configuration cannot be used. Contact the operator.',
      503,
      error,
    );
  }
}

/** A provider that disappears or becomes unreadable after dispatch has changed identity. */
export async function revalidateStatusProvider(
  tx: Prisma.TransactionClient,
  instanceId: string,
  tenantId: string,
): Promise<StatusProvider> {
  try {
    return await lockStatusProvider(tx, instanceId, tenantId);
  } catch (error) {
    if (!(error instanceof CredentialStatusError)) throw error;
    throw new CredentialStatusError(
      'STATUS_PROVIDER_CHANGED',
      'The status provider can no longer be resolved as inspected. Any pending intent is retained. Contact the operator before reconciliation.',
      503,
      error,
    );
  }
}

/** One deadline signal is shared by every provider call belonging to a reservation. */
export function statusDeadline(deadline: Date) {
  const deadlineAt = deadline.getTime();
  const signal = AbortSignal.timeout(Math.max(0, deadlineAt - Date.now()));
  const assertTime = () => {
    if (signal.aborted || Date.now() >= deadlineAt)
      throw new CredentialStatusError(
        'VC_SERVICE_UNAVAILABLE',
        'The status operation budget expired before the next provider call.',
        503,
      );
  };
  return { signal, deadlineAt, assertTime };
}

/** An unlocked check narrows dispatch races; the final write still fences on token and version. */
export async function assertPendingToken(entryId: string, tenantId: string, token: string): Promise<void> {
  let currentToken: string | null;
  try {
    currentToken = await readPendingToken(prisma, entryId, tenantId);
  } catch (error) {
    throw new CredentialStatusError(
      'STATUS_PERSISTENCE_FAILED',
      'Reservation ownership could not be checked. No further provider call was started and no observation was recorded. Read stored status before taking further action.',
      503,
      error,
    );
  }
  if (currentToken !== token) {
    throw new CredentialStatusError(
      'STATUS_PERSISTENCE_FAILED',
      'The status reservation changed. This request cannot record an observation. Read the stored status before taking further action.',
      503,
    );
  }
}

/** Checks the adapter contract before an observation can be committed or returned. */
export function checkedStatusObservation(
  entry: CredentialStatusEntry,
  observation: CredentialStatusObservation,
): CredentialStatusObservation {
  if (
    !observation ||
    typeof observation.value !== 'boolean' ||
    !z.string().datetime().safeParse(observation.observedAt).success ||
    observation.statusPurpose !== entry.statusPurpose ||
    observation.statusListCredential !== entry.statusListCredential ||
    observation.statusListIndex !== entry.statusListIndex
  ) {
    throw new CredentialStatusError(
      'VC_STATUS_RESPONSE_INVALID',
      'The status service returned an invalid observation. No status change was confirmed.',
      502,
    );
  }
  return observation;
}

export function statusObservationResponse(entry: CredentialStatusEntry, observation: CredentialStatusObservation) {
  return {
    entryId: entry.id,
    statusPurpose: entry.statusPurpose,
    value: observation.value,
    observedAt: observation.observedAt,
    version: entry.version + 1,
  };
}
