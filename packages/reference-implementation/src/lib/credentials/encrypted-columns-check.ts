/**
 * The check that holds the schema's `@encryptedAtRest` tags and the Prisma
 * envelope-store adapter equal (ADR-055). Run by scripts/check-encrypted-columns.ts
 * at build time and by prisma-envelope-stores.test.ts, so a column encrypted
 * under DATA_ENCRYPTION_KEY cannot be left out of the key lifecycle, and a
 * store cannot claim a column the schema does not mark.
 */

export const ENCRYPTED_AT_REST_TAG = '@encryptedAtRest';

/** The part of the generated client's data-model description the check reads. */
export type DataModelDescription = {
  datamodel: {
    models: ReadonlyArray<{ name: string; fields: ReadonlyArray<{ name: string; documentation?: string }> }>;
  };
};

/** Every `Model.field` whose schema comment carries the tag. */
export function taggedEncryptedColumns(dmmf: DataModelDescription): string[] {
  return dmmf.datamodel.models.flatMap((model) =>
    model.fields
      .filter((field) => field.documentation?.includes(ENCRYPTED_AT_REST_TAG))
      .map((field) => `${model.name}.${field.name}`),
  );
}

export type EncryptedColumnMismatch = {
  /** Tagged in the schema, no adapter reads it. */
  unadapted: string[];
  /** An adapter reads it, the schema does not tag it. */
  untagged: string[];
};

/** Null when the tagged set and the adapted set are the same. */
export function encryptedColumnMismatch(
  dmmf: DataModelDescription,
  adaptedColumns: readonly string[],
): EncryptedColumnMismatch | null {
  const tagged = new Set(taggedEncryptedColumns(dmmf));
  const adapted = new Set(adaptedColumns);
  const unadapted = [...tagged].filter((column) => !adapted.has(column)).sort();
  const untagged = [...adapted].filter((column) => !tagged.has(column)).sort();
  return unadapted.length === 0 && untagged.length === 0 ? null : { unadapted, untagged };
}
