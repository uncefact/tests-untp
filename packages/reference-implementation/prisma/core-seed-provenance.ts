import { RecordSource } from '../src/lib/prisma/generated/index.js';

interface ProvenanceDelegate {
  update: (args: { where: { id: string }; data: { source: RecordSource } }) => Promise<unknown>;
}

/**
 * Converges an existing core-seeded row's provenance to `CORE_SEED`. Rows
 * created before provenance tracking default to `USER`; stamping known core
 * ids on every boot keeps them out of reach of the custom-seed reconcile,
 * which may only ever touch `CUSTOM_SEED` rows.
 *
 * Returns true when a converging update was written, false when the row
 * already carried `CORE_SEED`.
 */
export async function convergeCoreProvenance(
  delegate: ProvenanceDelegate,
  id: string,
  existingSource: RecordSource,
): Promise<boolean> {
  if (existingSource === RecordSource.CORE_SEED) {
    return false;
  }
  await delegate.update({ where: { id }, data: { source: RecordSource.CORE_SEED } });
  return true;
}
