import type { LoggerService } from '@uncefact/untp-ri-services/logging';
import { appLogger } from '@/lib/api/logger';
import {
  decryptCredentialBatchItemRequest,
  buildCredentialBatchResolutionAudit,
  getCredentialBatchItemForInspection,
  resolveUnknownBatchItem,
  type CredentialBatchItemInspection,
  type ResolveUnknownBatchItemInput,
  type ResolveUnknownBatchItemResult,
} from '@/lib/prisma/repositories/credential-batch.repository';
import { prisma } from '@/lib/prisma/prisma';
import type { Prisma as PrismaTypes } from '@/lib/prisma/generated';
import { readLogLevel } from '@/lib/config/log-level.config';

type TransactionCallback = <T>(callback: (tx: PrismaTypes.TransactionClient) => Promise<T>) => Promise<T>;
type OperatorLogger = Pick<LoggerService, 'info' | 'warn'>;

export type OperatorOutput = {
  print: (line: string) => void;
  printError: (line: string) => void;
};

export type ResolveCredentialBatchItemOptions = ResolveUnknownBatchItemInput & {
  dryRun: boolean;
};

export type ResolveCredentialBatchItemDependencies = {
  transaction: TransactionCallback;
  resolve: typeof resolveUnknownBatchItem;
  logger: OperatorLogger;
  output: OperatorOutput;
  now: () => Date;
};

export type InspectCredentialBatchItemOptions = {
  tenantId: string;
  batchId: string;
  index: number;
  reason: string;
  discloseRequest: boolean;
};

export type InspectCredentialBatchItemDependencies = {
  getItem: typeof getCredentialBatchItemForInspection;
  decrypt: typeof decryptCredentialBatchItemRequest;
  logger: OperatorLogger;
  output: OperatorOutput;
  now: () => Date;
};

class DryRunRollback extends Error {
  constructor(readonly result: Extract<ResolveUnknownBatchItemResult, { outcome: 'applied' }>) {
    super('dry-run rollback');
  }
}

const defaultOutput: OperatorOutput = {
  print: (line) => console.log(line),
  printError: (line) => console.error(line),
};

const defaultLogger = appLogger.child({ module: 'credential-batch-operator' });

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function serialiseSnapshot(snapshot: NonNullable<ResolveUnknownBatchItemResult['before']>) {
  return {
    ...snapshot,
    createdAt: iso(snapshot.createdAt),
    settledAt: iso(snapshot.settledAt),
    resolvedAt: iso(snapshot.resolvedAt),
    expiresAt: iso(snapshot.expiresAt),
    itemUpdatedAt: iso(snapshot.itemUpdatedAt),
  };
}

function emitAudit(
  logger: OperatorLogger,
  audit: Record<string, unknown>,
  outcome: string,
  now: Date,
  extra: Record<string, unknown> = {},
): void {
  logger.warn({ ...audit, ...extra, outcome, at: now.toISOString() }, 'Credential batch operator audit');
}

function emitRequiredAudit(
  logger: OperatorLogger,
  audit: Record<string, unknown>,
  outcome: string,
  now: Date,
  extra: Record<string, unknown> = {},
): boolean {
  try {
    emitAudit(logger, audit, outcome, now, extra);
    return true;
  } catch {
    return false;
  }
}

function safeErrorType(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function defaultResolveDependencies(): ResolveCredentialBatchItemDependencies {
  return {
    transaction: (callback) => prisma.$transaction(callback, { maxWait: 5_000, timeout: 15_000 }),
    resolve: resolveUnknownBatchItem,
    logger: defaultLogger,
    output: defaultOutput,
    now: () => new Date(Date.now()),
  };
}

/** Runs the resolution command and reports before and after state without logging request content. */
export async function runResolveCredentialBatchItem(
  options: ResolveCredentialBatchItemOptions,
  overrides: Partial<ResolveCredentialBatchItemDependencies> = {},
): Promise<number> {
  const deps = { ...defaultResolveDependencies(), ...overrides };
  const audit = buildCredentialBatchResolutionAudit(options);
  let result: ResolveUnknownBatchItemResult;
  try {
    if (!options.dryRun) {
      result = await deps.transaction((tx) => deps.resolve(tx, options));
    } else {
      try {
        result = await deps.transaction(async (tx) => {
          const resolved = await deps.resolve(tx, options);
          if (resolved.outcome === 'applied') throw new DryRunRollback(resolved);
          return resolved;
        });
      } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
        result = error.result;
      }
    }
  } catch (error) {
    emitRequiredAudit(deps.logger, audit, 'error', deps.now(), { errorType: safeErrorType(error) });
    deps.output.printError('Credential batch item resolution could not complete.');
    return 1;
  }

  const auditOutcome = options.dryRun && result.outcome === 'applied' ? 'dry-run' : result.outcome;
  if (!emitRequiredAudit(deps.logger, result.audit, auditOutcome, deps.now(), options.dryRun ? { dryRun: true } : {})) {
    deps.output.printError('Credential batch item resolution could not be audited.');
    return 1;
  }
  if (result.before !== undefined) deps.output.print(`before: ${JSON.stringify(serialiseSnapshot(result.before))}`);
  if (result.outcome === 'applied') {
    deps.output.print(`after: ${JSON.stringify(serialiseSnapshot(result.after))}`);
    return 0;
  }
  deps.output.print(`outcome: ${result.outcome}`);
  return 1;
}

function inspectionAudit(
  options: InspectCredentialBatchItemOptions,
  version: number | null,
): {
  action: 'inspect';
  tenantId: string;
  batchId: string;
  index: number;
  version: number | null;
  reason: string;
} {
  return {
    action: 'inspect',
    tenantId: options.tenantId,
    batchId: options.batchId,
    index: options.index,
    version,
    reason: options.reason,
  };
}

function inspectionOutput(item: CredentialBatchItemInspection) {
  return {
    tenantId: item.tenantId,
    batchId: item.batchId,
    index: item.index,
    batchState: item.batchState,
    batchVersion: item.batchVersion,
    itemState: item.itemState,
    createdAt: item.createdAt.toISOString(),
    settledAt: iso(item.settledAt),
    resolvedAt: iso(item.resolvedAt),
    resolutionReason: item.resolutionReason,
    itemResolvedAt: iso(item.itemResolvedAt),
    itemUpdatedAt: item.itemUpdatedAt.toISOString(),
    credentialId: item.credentialId,
    error:
      item.errorClass === null || item.errorMessage === null
        ? null
        : { code: item.errorClass, message: item.errorMessage },
    requestDigest: item.requestDigest,
  };
}

function defaultInspectDependencies(): InspectCredentialBatchItemDependencies {
  return {
    getItem: getCredentialBatchItemForInspection,
    decrypt: decryptCredentialBatchItemRequest,
    logger: defaultLogger,
    output: defaultOutput,
    now: () => new Date(Date.now()),
  };
}

/** Runs the item inspection command, auditing access before any decrypted request is printed. */
export async function runInspectCredentialBatchItem(
  options: InspectCredentialBatchItemOptions,
  overrides: Partial<InspectCredentialBatchItemDependencies> = {},
): Promise<number> {
  const deps = { ...defaultInspectDependencies(), ...overrides };
  let item: CredentialBatchItemInspection | null;
  try {
    item = await deps.getItem(options.batchId, options.tenantId, options.index);
  } catch (error) {
    emitRequiredAudit(deps.logger, inspectionAudit(options, null), 'error', deps.now(), {
      disclosure: options.discloseRequest ? 'full' : 'identifiers',
      errorType: safeErrorType(error),
    });
    deps.output.printError('Credential batch item inspection could not complete.');
    return 1;
  }
  if (item === null) {
    emitRequiredAudit(deps.logger, inspectionAudit(options, null), 'missing', deps.now(), {
      disclosure: options.discloseRequest ? 'full' : 'identifiers',
    });
    deps.output.printError('Credential batch item was not found for this tenant.');
    return 1;
  }

  const output = inspectionOutput(item);
  if (!options.discloseRequest) {
    if (
      !emitRequiredAudit(deps.logger, inspectionAudit(options, item.batchVersion), 'found', deps.now(), {
        disclosure: 'identifiers',
      })
    ) {
      deps.output.printError('Credential batch item inspection could not be audited.');
      return 1;
    }
    deps.output.print(JSON.stringify(output));
    return 0;
  }

  if (['error', 'fatal', 'silent'].includes(readLogLevel())) {
    deps.output.printError('Request disclosure requires LOG_LEVEL=warn or a more verbose level.');
    return 1;
  }

  let request: unknown;
  try {
    request = JSON.parse(deps.decrypt(item.encryptedRequest));
  } catch (error) {
    emitRequiredAudit(deps.logger, inspectionAudit(options, item.batchVersion), 'decryption-failed', deps.now(), {
      disclosure: 'full',
      errorType: safeErrorType(error),
    });
    deps.output.printError('Credential batch item request could not be decrypted.');
    return 1;
  }

  // The audit is intentionally before both lines so plaintext cannot precede authorisation evidence.
  if (
    !emitRequiredAudit(deps.logger, inspectionAudit(options, item.batchVersion), 'found', deps.now(), {
      disclosure: 'full',
    })
  ) {
    deps.output.printError('Credential batch item inspection could not be audited.');
    return 1;
  }
  deps.output.print(JSON.stringify(output));
  deps.output.print(`request: ${JSON.stringify(request)}`);
  return 0;
}
