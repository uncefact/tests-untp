import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readReferenceImplementationVersion } from './version';

function layout(files: Record<string, object>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'version-'));
  for (const [relative, content] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(content));
  }
  return root;
}

describe('readReferenceImplementationVersion', () => {
  it('reads the package root in the checkout layout', () => {
    const root = layout({ 'package.json': { name: 'untp-reference-implementation', version: '0.4.0' } });
    expect(readReferenceImplementationVersion(path.join(root, 'src/worker'))).toEqual({ version: '0.4.0' });
  });

  it('reads the standalone path in the image layout, not the repository root beside it', () => {
    // In the image ../../package.json is the monorepo root (a different name
    // and version); the RI package sits where Next's standalone put it.
    const root = layout({
      'package.json': { name: 'tests-untp', version: '0.2.0' },
      'packages/reference-implementation/package.json': { name: 'untp-reference-implementation', version: '0.4.0' },
    });
    expect(readReferenceImplementationVersion(path.join(root, 'src/worker'))).toEqual({ version: '0.4.0' });
  });

  it("reports a reason rather than another package's version, naming what it passed over", () => {
    const root = layout({ 'package.json': { name: 'tests-untp', version: '0.2.0' } });
    expect(readReferenceImplementationVersion(path.join(root, 'src/worker'))).toEqual({
      reason: expect.stringContaining('package tests-untp'),
    });
  });

  it('passes over a candidate that is not valid JSON and says so', () => {
    const root = layout({});
    fs.writeFileSync(path.join(root, 'package.json'), '{ not json');
    expect(readReferenceImplementationVersion(path.join(root, 'src/worker'))).toEqual({
      reason: expect.stringContaining('not valid JSON'),
    });
  });

  it('passes over a candidate whose JSON is not an object, such as null, with a reason', () => {
    const root = layout({});
    fs.writeFileSync(path.join(root, 'package.json'), 'null');
    expect(readReferenceImplementationVersion(path.join(root, 'src/worker'))).toEqual({
      reason: expect.stringContaining('not a package manifest'),
    });
  });

  it('passes over this package with an empty version', () => {
    const root = layout({ 'package.json': { name: 'untp-reference-implementation', version: '' } });
    expect(readReferenceImplementationVersion(path.join(root, 'src/worker'))).toEqual({
      reason: expect.stringContaining('no version'),
    });
  });

  it('resolves the real checkout to this package', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as {
      version: string;
    };
    expect(readReferenceImplementationVersion(__dirname)).toEqual({ version: pkg.version });
  });
});
