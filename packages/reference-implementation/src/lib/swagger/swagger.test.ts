import fs from 'node:fs';
import path from 'node:path';
import { getApiDocs } from './swagger';

type Spec = { info?: { version?: string } };

describe('published API document version', () => {
  it("reports this package's release version", async () => {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8')) as {
      version: string;
    };

    const spec = (await getApiDocs()) as Spec;

    expect(spec.info?.version).toBe(manifest.version);
  });
});
