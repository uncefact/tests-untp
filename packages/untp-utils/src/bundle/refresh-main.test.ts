// Drives the refresh script's main() against a temporary copy of the bundle
// with fetch stubbed, so the refusal, repair and dry-run paths are proven
// without the network. The script is loaded by runtime URL (tsc's rootDir is
// `src`); UNTP_ARTEFACTS_ROOT points it at the temporary tree.
import { jest } from '@jest/globals';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

type Script = {
  main: (argv?: string[], deps?: { fetchImpl: typeof fetch }) => Promise<void>;
  ARTEFACTS: { file: string; source: string }[];
};
const scriptUrl = new URL('../../scripts/refresh-artefacts.mjs', import.meta.url).href;
const packageRoot = new URL('../../', import.meta.url).pathname;

describe('refresh-artefacts main', () => {
  let root: string;
  let script: Script;
  let exit: jest.SpiedFunction<typeof process.exit>;
  let stubbed: Map<string, string>;
  let fetchImpl: typeof fetch;
  const run = (argv: string[]) => script.main(argv, { fetchImpl });

  beforeAll(async () => {
    // The script resolves its root when it loads, so the temporary root is
    // fixed before the import and refilled from the real bundle per test.
    root = await mkdtemp(join(tmpdir(), 'untp-artefacts-'));
    process.env.UNTP_ARTEFACTS_ROOT = root;
    script = (await import(scriptUrl)) as Script;
  });

  afterAll(async () => {
    delete process.env.UNTP_ARTEFACTS_ROOT;
    await rm(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await rm(join(root, 'artefacts'), { recursive: true, force: true });
    await rm(join(root, 'src'), { recursive: true, force: true });
    await cp(join(packageRoot, 'artefacts'), join(root, 'artefacts'), { recursive: true });
    await cp(join(packageRoot, 'src', 'bundle'), join(root, 'src', 'bundle'), { recursive: true });
    // Serve every source from the bundled copy on disk, so "published" equals "bundled".
    stubbed = new Map();
    for (const { file, source } of script.ARTEFACTS) {
      stubbed.set(source, await readFile(join(packageRoot, 'artefacts', file), 'utf8'));
    }
    fetchImpl = (async (url: string | URL | Request) => {
      const body = stubbed.get(String(url));
      return body === undefined
        ? new Response('missing', { status: 404 })
        : new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit ${code}`);
    }) as never);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const corruptFile = 'context/untp/0.6.0/dia.json';

  it('--check passes on a matching tree and writes nothing', async () => {
    const before = await readFile(join(root, 'artefacts', 'manifest.json'), 'utf8');
    await run(['--check']);
    expect(exit).not.toHaveBeenCalled();
    expect(await readFile(join(root, 'artefacts', 'manifest.json'), 'utf8')).toBe(before);
  });

  it('--check refuses a corrupt bundled copy, naming it, and writes nothing', async () => {
    await writeFile(join(root, 'artefacts', corruptFile), '{not json');
    await expect(run(['--check'])).rejects.toThrow('exit 1');
    expect(await readFile(join(root, 'artefacts', corruptFile), 'utf8')).toBe('{not json');
  });

  it('a plain refresh also refuses a corrupt copy rather than hashing it', async () => {
    await writeFile(join(root, 'artefacts', corruptFile), '{not json');
    await expect(run([])).rejects.toThrow('exit 1');
    expect(await readFile(join(root, 'artefacts', corruptFile), 'utf8')).toBe('{not json');
  });

  it('--force repairs a corrupt copy from the published source', async () => {
    await writeFile(join(root, 'artefacts', corruptFile), '{not json');
    await run(['--force']);
    expect(exit).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(join(root, 'artefacts', corruptFile), 'utf8'))).toHaveProperty('@context');
  });

  it('refuses a published copy that differs unless forced', async () => {
    const entry = script.ARTEFACTS.find((a) => a.file === corruptFile)!;
    stubbed.set(entry.source, JSON.stringify({ '@context': { changed: true } }));
    await expect(run(['--check'])).rejects.toThrow('exit 1');
    await expect(run([])).rejects.toThrow('exit 1');
    await run(['--force']);
    expect(JSON.parse(await readFile(join(root, 'artefacts', corruptFile), 'utf8'))).toEqual({
      '@context': { changed: true },
    });
  });

  it('writes nothing when a later fetch fails', async () => {
    const entry = script.ARTEFACTS[script.ARTEFACTS.length - 1];
    stubbed.delete(entry.source);
    await writeFile(join(root, 'artefacts', corruptFile), '{not json');
    await expect(run(['--force'])).rejects.toThrow(/answered 404/);
    expect(await readFile(join(root, 'artefacts', corruptFile), 'utf8')).toBe('{not json');
  });

  it('rejects --check together with --force', async () => {
    await expect(run(['--check', '--force'])).rejects.toThrow('exit 1');
  });
});
