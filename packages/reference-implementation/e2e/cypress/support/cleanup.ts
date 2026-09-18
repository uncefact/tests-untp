export type CleanupActor = {
  name: string;
  headers: Record<string, string>;
};

export type CleanupFailure = {
  actor: string;
  collection: string;
  message: string;
};

export type CleanupOptions = {
  baseUrl: string;
  tag: string;
  actors: CleanupActor[];
  statusReconcileGraceMs: number;
  statusCleanupTimeoutMs: number;
};

export type CleanupResult = {
  failures: CleanupFailure[];
  matchedRows: number;
};

export type ResidueRow = {
  actor: string;
  collection: string;
  id: string;
  tags: string[];
};

type Collection = {
  name: string;
  path: string;
  deletePath?: (id: string, row: Record<string, unknown>) => string;
  beforeDelete?: (
    options: CleanupOptions,
    actor: CleanupActor,
    id: string,
    row: Record<string, unknown>,
  ) => Promise<void>;
};

type ApiBody = {
  data?: unknown;
  pagination?: {
    hasMore?: boolean;
    limit?: number;
  };
  failures?: Array<{ id?: string; message?: string }>;
};

const COLLECTIONS: Collection[] = [
  {
    name: 'library records',
    path: '/api/v1/library',
    // A credential this service issued is deleted through the credentials
    // route; the library route refuses native records.
    deletePath: (id, row) =>
      row.origin === 'native'
        ? `/api/v1/credentials/${encodeURIComponent(id)}`
        : `/api/v1/library/${encodeURIComponent(id)}`,
  },
  {
    name: 'render templates',
    path: '/api/v1/render-templates',
    deletePath: (id) => `/api/v1/render-templates/${encodeURIComponent(id)}`,
  },
  {
    name: 'data models',
    path: '/api/v1/data-models',
    deletePath: (id) => `/api/v1/data-models/${encodeURIComponent(id)}`,
  },
  { name: 'products', path: '/api/v1/products', deletePath: (id) => `/api/v1/products/${encodeURIComponent(id)}` },
  {
    name: 'facilities',
    path: '/api/v1/facilities',
    deletePath: (id) => `/api/v1/facilities/${encodeURIComponent(id)}`,
  },
  {
    name: 'organisations',
    path: '/api/v1/organisations',
    deletePath: (id) => `/api/v1/organisations/${encodeURIComponent(id)}`,
  },
  {
    name: 'identifiers',
    path: '/api/v1/identifiers',
    deletePath: (id) => `/api/v1/identifiers/${encodeURIComponent(id)}`,
  },
  {
    name: 'identifier schemes',
    path: '/api/v1/schemes',
    deletePath: (id) => `/api/v1/schemes/${encodeURIComponent(id)}`,
  },
  {
    name: 'registrars',
    path: '/api/v1/registrars',
    deletePath: (id) => `/api/v1/registrars/${encodeURIComponent(id)}`,
  },
  {
    name: 'DIDs',
    path: '/api/v1/dids',
    deletePath: (id) => `/api/v1/dids/${encodeURIComponent(id)}`,
    // A DID flagged default cannot be deleted; an interrupted run can leave a
    // tagged DID in that state, so the flag is cleared first.
    beforeDelete: async (options, actor, id, row) => {
      if (row.isDefault !== true) return;
      const response = await fetch(apiUrl(options.baseUrl, `/api/v1/dids/${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: { ...actor.headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: false }),
      });
      if (!response.ok && response.status !== 404) {
        throw new Error(`PATCH /api/v1/dids/${id} (clear default) returned ${await responseDescription(response)}`);
      }
    },
  },
  {
    name: 'service instances',
    path: '/api/v1/services',
    deletePath: (id) => `/api/v1/services/${encodeURIComponent(id)}`,
  },
  { name: 'conformity schemes', path: '/api/v1/cvc/schemes' },
  { name: 'conformity profiles', path: '/api/v1/cvc/profiles' },
  { name: 'conformity criteria', path: '/api/v1/cvc/criteria' },
];

const RUN_TAG_PATTERN = /e2e-\d{10,}/g;

function apiUrl(baseUrl: string, path: string, offset?: number): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (offset !== undefined && offset > 0) url.searchParams.set('offset', String(offset));
  return url.href;
}

async function responseDescription(response: Response): Promise<string> {
  const body = await response.text();
  return body ? `${response.status} ${body.slice(0, 500)}` : String(response.status);
}

function formatDeleteFailureDescription(path: string, status: number, body: string): string {
  return `DELETE ${path} returned ${status}${body ? ` ${body.slice(0, 500)}` : ''}`;
}

type ListingContext = Map<string, Record<string, unknown>[]>;

function collectionPaths(collection: Collection, context: ListingContext): string[] {
  if (collection.name === 'conformity profiles') {
    return [...new Set((context.get('conformity schemes') ?? []).map(rowId).filter((id): id is string => !!id))].map(
      (schemeId) => `${collection.path}?schemeId=${encodeURIComponent(schemeId)}`,
    );
  }
  if (collection.name === 'conformity criteria') {
    return [...new Set((context.get('conformity profiles') ?? []).map(rowId).filter((id): id is string => !!id))].map(
      (profileId) => `${collection.path}?profileId=${encodeURIComponent(profileId)}`,
    );
  }
  return [collection.path];
}

async function listCollection(
  options: CleanupOptions,
  actor: CleanupActor,
  collection: Collection,
  context: ListingContext,
): Promise<{ rows: Record<string, unknown>[]; failures: CleanupFailure[] }> {
  const rows: Record<string, unknown>[] = [];
  const failures: CleanupFailure[] = [];

  for (const collectionPath of collectionPaths(collection, context)) {
    let offset = 0;
    let finished = false;
    for (let page = 0; page < 10000; page += 1) {
      const response = await fetch(apiUrl(options.baseUrl, collectionPath, offset), {
        headers: actor.headers,
      });
      if (!response.ok) {
        throw new Error(`GET ${collectionPath} returned ${await responseDescription(response)}`);
      }

      const body = (await response.json()) as ApiBody;
      if (!Array.isArray(body.data)) {
        throw new Error(`GET ${collectionPath} returned a body without a data array`);
      }
      body.data.forEach((row, index) => {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) {
          failures.push({
            actor: actor.name,
            collection: collection.name,
            message: `The API returned a non-object row at page offset ${offset}, index ${index}`,
          });
          return;
        }
        rows.push(row as Record<string, unknown>);
      });

      for (const failure of body.failures ?? []) {
        failures.push({
          actor: actor.name,
          collection: collection.name,
          message: `The API could not read row ${failure.id ?? '(unknown id)'}: ${
            failure.message ?? 'unknown failure'
          }`,
        });
      }

      // A page that does not say whether more follow is not evidence that
      // none do: the enumeration is reported as incomplete rather than clean.
      if (body.pagination === undefined || typeof body.pagination.hasMore !== 'boolean') {
        throw new Error(`GET ${collectionPath} returned a page without a boolean pagination.hasMore`);
      }
      if (!body.pagination.hasMore) {
        finished = true;
        break;
      }

      const limit = body.pagination.limit;
      if (typeof limit !== 'number' || limit < 1) {
        throw new Error(`GET ${collectionPath} reported hasMore without a usable pagination limit`);
      }
      offset += limit;
    }
    if (!finished) throw new Error(`GET ${collectionPath} exceeded the pagination safety limit`);
  }

  return { rows, failures };
}

function rowId(row: Record<string, unknown>): string | undefined {
  if (typeof row.id === 'string' && row.id) return row.id;
  if (typeof row.credentialId === 'string' && row.credentialId) return row.credentialId;
  return undefined;
}

function rowContainsTag(row: Record<string, unknown>, tag: string): boolean {
  return new RegExp(`${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\d)`).test(JSON.stringify(row));
}

function rowTags(row: Record<string, unknown>): string[] {
  return [...new Set(JSON.stringify(row).match(RUN_TAG_PATTERN) ?? [])];
}

function dependencyDepth(
  row: Record<string, unknown>,
  rows: Record<string, unknown>[],
  parentField: string,
  seen = new Set<string>(),
): number {
  const parentId = row[parentField];
  if (typeof parentId !== 'string' || !parentId) return 0;
  if (seen.has(parentId)) return 0;
  seen.add(parentId);

  const parent = rows.find((candidate) => rowId(candidate) === parentId);
  if (!parent || parent === row) return 0;
  return 1 + dependencyDepth(parent, rows, parentField, seen);
}

function rowsInDeleteOrder(collection: Collection, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const parentField =
    collection.name === 'products' ? 'parentId' : collection.name === 'data models' ? 'parentConfigId' : null;
  if (!parentField) return rows;
  return [...rows].sort(
    (left, right) => dependencyDepth(right, rows, parentField) - dependencyDepth(left, rows, parentField),
  );
}

type StatusApiError = { code?: unknown; error?: unknown };

type PendingStatusEntry = {
  purpose: string;
  version: number;
  deadlineAt: number;
};

function statusEntriesOf(row: Record<string, unknown>): Array<Record<string, unknown>> {
  const status = row.status;
  if (status === null || typeof status !== 'object' || Array.isArray(status)) return [];
  const entries = (status as Record<string, unknown>).entries;
  return Array.isArray(entries)
    ? entries.filter(
        (entry): entry is Record<string, unknown> =>
          entry !== null && typeof entry === 'object' && !Array.isArray(entry),
      )
    : [];
}

function pendingStatusEntryOf(entry: Record<string, unknown>): PendingStatusEntry | undefined {
  const pending = entry.pending;
  if (pending === null || pending === undefined) return undefined;
  if (
    typeof entry.statusPurpose !== 'string' ||
    typeof entry.version !== 'number' ||
    !Number.isInteger(entry.version) ||
    pending === null ||
    typeof pending !== 'object' ||
    Array.isArray(pending)
  ) {
    return undefined;
  }
  const pendingRecord = pending as Record<string, unknown>;
  if (
    typeof pendingRecord.value !== 'boolean' ||
    typeof pendingRecord.since !== 'string' ||
    !Number.isFinite(Date.parse(pendingRecord.since))
  ) {
    return undefined;
  }
  const deadline = pendingRecord.deadline;
  if (typeof deadline !== 'string') return undefined;
  const deadlineAt = Date.parse(deadline);
  if (!Number.isFinite(deadlineAt)) return undefined;
  return { purpose: entry.statusPurpose, version: entry.version, deadlineAt };
}

function pendingPurposeNamesFromError(error: string): string[] {
  return (
    error
      .match(/for purposes:\s*(.+?)\.\s+Wait/i)?.[1]
      ?.split(',')
      .map((purpose) => purpose.trim())
      .filter(Boolean) ?? []
  );
}

async function readResponseBody(response: Response): Promise<{ body: string; parsed: StatusApiError }> {
  const body = await response.text();
  try {
    return { body, parsed: JSON.parse(body) as StatusApiError };
  } catch {
    return { body, parsed: {} };
  }
}

async function deleteRow(
  options: CleanupOptions,
  actor: CleanupActor,
  collection: Collection,
  id: string,
  row: Record<string, unknown>,
  cleanupDeadline: number,
): Promise<CleanupFailure[]> {
  if (!collection.deletePath) {
    return [
      {
        actor: actor.name,
        collection: collection.name,
        message: `Row ${id} carries ${options.tag}, but the RI exposes no delete route for ${collection.name}`,
      },
    ];
  }

  if (collection.beforeDelete) await collection.beforeDelete(options, actor, id, row);
  const path = collection.deletePath(id, row);
  const response = await fetch(apiUrl(options.baseUrl, path), {
    method: 'DELETE',
    headers: actor.headers,
  });
  if (response.ok || response.status === 404) return [];

  const initialResponse = await readResponseBody(response);
  const responseBody = initialResponse.body;
  const parsedBody = initialResponse.parsed;

  if (
    response.status === 409 &&
    parsedBody.code === 'STATUS_OPERATION_IN_PROGRESS' &&
    collection.name === 'library records'
  ) {
    const pendingError = typeof parsedBody.error === 'string' ? parsedBody.error : responseBody;
    const entries = statusEntriesOf(row);
    const structuralPendingEntries = entries.filter((entry) => entry.pending !== null && entry.pending !== undefined);
    const pendingEntries = structuralPendingEntries.map(pendingStatusEntryOf);
    const pendingPurposes = pendingEntries
      .filter((entry): entry is PendingStatusEntry => entry !== undefined)
      .map((entry) => entry.purpose);
    const namedPurposes = structuralPendingEntries.length === 0 ? pendingPurposeNamesFromError(pendingError) : [];
    const purposes = [...new Set([...pendingPurposes, ...namedPurposes])];
    const failures: CleanupFailure[] = [];
    const deleteDescription = formatDeleteFailureDescription(path, response.status, responseBody);
    const purposesDescription = purposes.join(', ') || '(unknown)';
    const failure = (message: string): CleanupFailure => ({
      actor: actor.name,
      collection: collection.name,
      message: `${message} for row ${id}; purposes: ${purposesDescription}`,
    });

    if (structuralPendingEntries.length > 0) {
      const immediateRetry = await fetch(apiUrl(options.baseUrl, path), {
        method: 'DELETE',
        headers: actor.headers,
      });
      if (immediateRetry.ok || immediateRetry.status === 404) return [];
      const immediateRetryResponse = await readResponseBody(immediateRetry);
      if (immediateRetry.status !== 409 || immediateRetryResponse.parsed.code !== 'STATUS_OPERATION_IN_PROGRESS') {
        failures.push(
          failure(
            `${formatDeleteFailureDescription(
              path,
              immediateRetry.status,
              immediateRetryResponse.body,
            )}; last response`,
          ),
        );
        return failures;
      }

      if (pendingEntries.some((entry) => entry === undefined) || purposes.length === 0) {
        failures.push(failure(`${deleteDescription}, but the structural pending status was invalid`));
        return failures;
      }

      const pendingDeadline = Math.max(...pendingEntries.map((entry) => (entry as PendingStatusEntry).deadlineAt));
      const resumeAt = pendingDeadline + options.statusReconcileGraceMs;
      const cappedResumeAt = Math.min(resumeAt, cleanupDeadline);
      if (Date.now() < cappedResumeAt) {
        console.info(
          `E2E status cleanup waiting: row ${id}; purposes: ${purposesDescription}; deadline: ${new Date(
            pendingDeadline,
          ).toISOString()}; resume: ${new Date(cappedResumeAt).toISOString()}`,
        );
        await new Promise((resolve) => setTimeout(resolve, cappedResumeAt - Date.now()));
      }
      if (Date.now() >= cleanupDeadline) {
        failures.push(
          failure(
            `Status cleanup budget exhausted; last response: ${formatDeleteFailureDescription(
              path,
              immediateRetry.status,
              immediateRetryResponse.body,
            )}`,
          ),
        );
        return failures;
      }

      const currentResponse = await fetch(apiUrl(options.baseUrl, `/api/v1/library/${encodeURIComponent(id)}`), {
        headers: actor.headers,
      });
      if (!currentResponse.ok) {
        const currentBody = await readResponseBody(currentResponse);
        failures.push(
          failure(
            `Could not read the current library row; last response: ${formatDeleteFailureDescription(
              `/api/v1/library/${encodeURIComponent(id)}`,
              currentResponse.status,
              currentBody.body,
            )}`,
          ),
        );
        return failures;
      }
      const currentRowResponse = await readResponseBody(currentResponse);
      let currentRow: Record<string, unknown>;
      try {
        currentRow = JSON.parse(currentRowResponse.body) as Record<string, unknown>;
      } catch {
        failures.push(failure(`The current library row was not valid JSON; last response: ${currentRowResponse.body}`));
        return failures;
      }
      const currentEntries = statusEntriesOf(currentRow);
      const entriesToReconcile = currentEntries.filter(
        (entry) =>
          purposes.includes(entry.statusPurpose as string) && entry.pending !== null && entry.pending !== undefined,
      );
      const invalidCurrentEntries = entriesToReconcile.filter((entry) => pendingStatusEntryOf(entry) === undefined);
      if (invalidCurrentEntries.length > 0) {
        failures.push(failure(`The current library row has invalid pending status metadata`));
        return failures;
      }

      for (const entry of entriesToReconcile) {
        const purpose = entry.statusPurpose as string;
        let version = (entry.version as number) ?? undefined;
        if (typeof version !== 'number' || !Number.isInteger(version)) {
          failures.push(failure(`The current library row has no version for status purpose "${purpose}"`));
          continue;
        }
        if (Date.now() >= cleanupDeadline) {
          failures.push(failure(`Status cleanup budget exhausted before reconciling purpose "${purpose}"`));
          continue;
        }
        const reconcilePath = `/api/v1/credentials/${encodeURIComponent(id)}/status/${encodeURIComponent(
          purpose,
        )}/reconcile`;
        const reconcile = async (entryVersion: number) => {
          const reconcileResponse = await fetch(apiUrl(options.baseUrl, reconcilePath), {
            method: 'POST',
            headers: {
              ...actor.headers,
              'Content-Type': 'application/json',
              'If-Version': String(entryVersion),
            },
            body: JSON.stringify({}),
          });
          return { response: reconcileResponse, body: await readResponseBody(reconcileResponse) };
        };
        let reconcileResult = await reconcile(version);
        if (!reconcileResult.response.ok && reconcileResult.body.parsed.code === 'VERSION_CONFLICT') {
          const rereadResponse = await fetch(apiUrl(options.baseUrl, `/api/v1/library/${encodeURIComponent(id)}`), {
            headers: actor.headers,
          });
          if (!rereadResponse.ok) {
            const rereadBody = await readResponseBody(rereadResponse);
            failures.push(
              failure(
                `Could not re-read the current version for status purpose "${purpose}"; last response: ${formatDeleteFailureDescription(
                  `/api/v1/library/${encodeURIComponent(id)}`,
                  rereadResponse.status,
                  rereadBody.body,
                )}`,
              ),
            );
            continue;
          }
          const rereadBody = await readResponseBody(rereadResponse);
          let rereadRow: Record<string, unknown>;
          try {
            rereadRow = JSON.parse(rereadBody.body) as Record<string, unknown>;
          } catch {
            failures.push(failure(`The re-read library row was not valid JSON for status purpose "${purpose}"`));
            continue;
          }
          const rereadEntry = statusEntriesOf(rereadRow).find((candidate) => candidate.statusPurpose === purpose);
          const rereadVersion = rereadEntry?.version;
          if (!rereadEntry) {
            failures.push(failure(`The re-read library row had no status entry for purpose "${purpose}"`));
            continue;
          }
          if (rereadEntry.pending === null || rereadEntry.pending === undefined) continue;
          if (
            typeof rereadVersion !== 'number' ||
            !Number.isInteger(rereadVersion) ||
            pendingStatusEntryOf(rereadEntry) === undefined
          ) {
            failures.push(failure(`The re-read library row had invalid status metadata for purpose "${purpose}"`));
            continue;
          }
          version = rereadVersion;
          reconcileResult = await reconcile(version);
        }
        if (!reconcileResult.response.ok) {
          failures.push(
            failure(
              `POST ${reconcilePath} returned ${reconcileResult.response.status}; last response: ${
                reconcileResult.body.body || String(reconcileResult.response.status)
              }`,
            ),
          );
        }
      }
      if (failures.length > 0) return failures;
    } else {
      const versionedEntries = entries.filter(
        (entry) =>
          typeof entry.statusPurpose === 'string' &&
          typeof entry.version === 'number' &&
          Number.isInteger(entry.version),
      );
      if (purposes.length === 0) {
        failures.push(
          failure(`${deleteDescription}, but no status purpose was available to reconcile: ${pendingError}`),
        );
        return failures;
      }

      for (const purpose of purposes) {
        const entry = versionedEntries.find((candidate) => candidate.statusPurpose === purpose);
        if (!entry) {
          failures.push(failure(`No current status entry version was available for purpose "${purpose}"`));
          continue;
        }
        const reconcilePath = `/api/v1/credentials/${encodeURIComponent(id)}/status/${encodeURIComponent(
          purpose,
        )}/reconcile`;
        const reconcile = async (entryVersion: number) => {
          const reconcileResponse = await fetch(apiUrl(options.baseUrl, reconcilePath), {
            method: 'POST',
            headers: {
              ...actor.headers,
              'Content-Type': 'application/json',
              'If-Version': String(entryVersion),
            },
            body: JSON.stringify({}),
          });
          return { response: reconcileResponse, body: await readResponseBody(reconcileResponse) };
        };
        let reconcileResult = await reconcile(entry.version as number);
        if (!reconcileResult.response.ok && reconcileResult.body.parsed.code === 'VERSION_CONFLICT') {
          if (Date.now() >= cleanupDeadline) {
            failures.push(failure(`Status cleanup budget exhausted before retrying purpose "${purpose}"`));
            continue;
          }
          const rereadResponse = await fetch(apiUrl(options.baseUrl, `/api/v1/library/${encodeURIComponent(id)}`), {
            headers: actor.headers,
          });
          if (!rereadResponse.ok) {
            const rereadBody = await readResponseBody(rereadResponse);
            failures.push(
              failure(
                `Could not re-read the current version for status purpose "${purpose}"; last response: ${formatDeleteFailureDescription(
                  `/api/v1/library/${encodeURIComponent(id)}`,
                  rereadResponse.status,
                  rereadBody.body,
                )}`,
              ),
            );
            continue;
          }
          const rereadBody = await readResponseBody(rereadResponse);
          let rereadRow: Record<string, unknown>;
          try {
            rereadRow = JSON.parse(rereadBody.body) as Record<string, unknown>;
          } catch {
            failures.push(failure(`The re-read library row was not valid JSON for status purpose "${purpose}"`));
            continue;
          }
          const rereadEntry = statusEntriesOf(rereadRow).find((candidate) => candidate.statusPurpose === purpose);
          const rereadVersion = rereadEntry?.version;
          if (!rereadEntry || typeof rereadVersion !== 'number' || !Number.isInteger(rereadVersion)) {
            failures.push(failure(`The re-read library row had no current version for status purpose "${purpose}"`));
            continue;
          }
          reconcileResult = await reconcile(rereadVersion);
        }
        if (!reconcileResult.response.ok) {
          failures.push(
            failure(
              `POST ${reconcilePath} returned ${reconcileResult.response.status}; last response: ${
                reconcileResult.body.body || String(reconcileResult.response.status)
              }`,
            ),
          );
        }
      }
      if (failures.length > 0) return failures;
    }

    const retryResponse = await fetch(apiUrl(options.baseUrl, path), {
      method: 'DELETE',
      headers: actor.headers,
    });
    if (!retryResponse.ok && retryResponse.status !== 404) {
      const retryBody = await readResponseBody(retryResponse);
      failures.push(
        failure(`${formatDeleteFailureDescription(path, retryResponse.status, retryBody.body)}; last response`),
      );
    }
    return failures;
  }

  return [
    {
      actor: actor.name,
      collection: collection.name,
      message: `${formatDeleteFailureDescription(path, response.status, responseBody)} for row ${id}`,
    },
  ];
}

/** The error's message with its cause chain, so a wrapped fetch failure names what actually failed. */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts = [error.message];
  let cause: unknown = (error as { cause?: unknown }).cause;
  while (cause instanceof Error) {
    parts.push(cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join(': ');
}

export async function cleanupRunData(options: CleanupOptions): Promise<CleanupResult> {
  const failures: CleanupFailure[] = [];
  let matchedRows = 0;
  const cleanupDeadline = Date.now() + options.statusCleanupTimeoutMs;

  for (const actor of options.actors) {
    const context: ListingContext = new Map();
    for (const collection of COLLECTIONS) {
      let listing;
      try {
        listing = await listCollection(options, actor, collection, context);
      } catch (error) {
        failures.push({
          actor: actor.name,
          collection: collection.name,
          message: describeError(error),
        });
        continue;
      }

      context.set(collection.name, listing.rows);
      failures.push(...listing.failures);
      for (const row of rowsInDeleteOrder(collection, listing.rows)) {
        if (!rowContainsTag(row, options.tag)) continue;
        matchedRows += 1;
        const id = rowId(row);
        if (!id) {
          failures.push({
            actor: actor.name,
            collection: collection.name,
            message: `A row carrying ${options.tag} has no API-visible id`,
          });
          continue;
        }

        try {
          failures.push(...(await deleteRow(options, actor, collection, id, row, cleanupDeadline)));
        } catch (error) {
          failures.push({
            actor: actor.name,
            collection: collection.name,
            message: describeError(error),
          });
        }
      }
    }
  }

  return { failures, matchedRows };
}

export async function findTaggedRows(
  options: CleanupOptions,
  predicate: (tags: string[]) => boolean,
): Promise<{
  failures: CleanupFailure[];
  rows: ResidueRow[];
}> {
  const failures: CleanupFailure[] = [];
  const rows: ResidueRow[] = [];

  for (const actor of options.actors) {
    const context: ListingContext = new Map();
    for (const collection of COLLECTIONS) {
      try {
        const listing = await listCollection(options, actor, collection, context);
        context.set(collection.name, listing.rows);
        failures.push(...listing.failures);
        for (const row of listing.rows) {
          const tags = rowTags(row);
          if (!predicate(tags)) continue;
          rows.push({
            actor: actor.name,
            collection: collection.name,
            id: rowId(row) ?? '(unknown id)',
            tags,
          });
        }
      } catch (error) {
        failures.push({
          actor: actor.name,
          collection: collection.name,
          message: describeError(error),
        });
      }
    }
  }

  return { failures, rows };
}

export { COLLECTIONS };
