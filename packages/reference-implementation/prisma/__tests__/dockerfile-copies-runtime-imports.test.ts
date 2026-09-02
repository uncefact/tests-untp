/**
 * The published image runs the seed and the operator scripts under tsx from
 * source files the Dockerfile copies one by one (ADR-043). A module those
 * entry points import that the Dockerfile does not copy fails only when the
 * image starts, which nothing else in the build catches. This walks every
 * relative import reachable from the in-image entry points and requires each
 * file under src/ to be covered by a COPY line, either itself or through a
 * copied directory.
 */
import fs from 'node:fs';
import path from 'node:path';

const packageRoot = path.resolve(__dirname, '../..');

/** Paths (relative to the package) the Dockerfile copies into the runtime image, files or directories. */
function copiedPaths(): string[] {
  const dockerfile = fs
    .readFileSync(path.join(packageRoot, 'Dockerfile'), 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  return [
    ...dockerfile.matchAll(
      /COPY --from=builder\S* (?:--chown=\S+ )?\/app\/packages\/reference-implementation\/(\S+) \.\//g,
    ),
  ].map((match) => match[1].replace(/\/$/, ''));
}

function isCovered(relative: string, copied: string[]): boolean {
  return copied.some((entry) => relative === entry || relative.startsWith(`${entry}/`));
}

/** The relative imports of one TypeScript file, static and dynamic. */
function relativeImports(file: string): string[] {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)].map((match) => match[1]);
}

/** Resolves an import specifier to an existing file, honouring the `.js` suffix convention for `.ts` sources. */
function resolveImport(from: string, specifier: string): string | null {
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base,
    `${base}.ts`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

function entryPoints(): string[] {
  const list = (dir: string) =>
    fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((name) => name.endsWith('.ts'))
          .map((name) => path.join(dir, name))
      : [];
  return [
    ...list(path.join(packageRoot, 'scripts')),
    ...list(path.join(packageRoot, 'prisma')),
    ...list(path.join(packageRoot, 'prisma/backfills')),
  ];
}

describe('the Dockerfile copies every source module the in-image tsx entry points import', () => {
  it('leaves no relative import under src/ uncovered', () => {
    const copied = copiedPaths();
    expect(copied.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    const uncovered = new Map<string, string>();
    const unresolved: string[] = [];
    const queue = entryPoints();
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const specifier of relativeImports(file)) {
        const target = resolveImport(file, specifier);
        if (target === null) {
          unresolved.push(`${specifier} (imported from ${path.relative(packageRoot, file)})`);
          continue;
        }
        const relative = path.relative(packageRoot, target);
        if (relative.startsWith('src/') && !isCovered(relative, copied)) {
          uncovered.set(relative, path.relative(packageRoot, file));
        }
        // The generated client is copied as a directory and is not source to walk.
        if (!relative.includes('src/lib/prisma/generated')) queue.push(target);
      }
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(unresolved).toEqual([]);
    expect([...uncovered.entries()].map(([missing, importer]) => `${missing} (imported from ${importer})`)).toEqual([]);
  });
});
