/**
 * Fails the build when a column tagged `@encryptedAtRest` in schema.prisma
 * has no envelope-store adapter, or an adapter names a column the schema does
 * not tag (ADR-055). Reads the tags from the generated client, so it runs
 * after `prisma generate`.
 *
 *   pnpm build   (runs this before next build)
 */
import { Prisma } from '../src/lib/prisma/generated/index.js';
import { encryptedColumnMismatch } from '../src/lib/credentials/encrypted-columns-check.js';
import { PRISMA_STORE_COLUMNS } from '../src/lib/credentials/prisma-envelope-stores.js';

const mismatch = encryptedColumnMismatch(Prisma.dmmf, Object.values(PRISMA_STORE_COLUMNS));
if (mismatch === null) {
  console.log(
    `Encrypted columns: every @encryptedAtRest column has an envelope-store adapter (${Object.values(
      PRISMA_STORE_COLUMNS,
    ).join(', ')}).`,
  );
} else {
  for (const column of mismatch.unadapted) {
    console.error(
      `${column} is tagged @encryptedAtRest in schema.prisma but no envelope store reads it: add a store to ` +
        'src/lib/credentials/envelope-stores.ts and its adapter to prisma-envelope-stores.ts, or the audit, ' +
        'rotation and startup validation will skip it.',
    );
  }
  for (const column of mismatch.untagged) {
    console.error(`${column} has an envelope-store adapter but is not tagged @encryptedAtRest in schema.prisma.`);
  }
  process.exit(1);
}
