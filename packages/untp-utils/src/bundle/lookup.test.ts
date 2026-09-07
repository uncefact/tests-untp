import { findBundledArtefact, normaliseArtefactUrl } from './lookup.js';

describe('normaliseArtefactUrl', () => {
  it.each([
    ['https://vocabulary.uncefact.org/untp/0.7.0/context/', 'https://vocabulary.uncefact.org/untp/0.7.0/context'],
    ['https://VOCABULARY.uncefact.org/untp/0.7.0/context', 'https://vocabulary.uncefact.org/untp/0.7.0/context'],
    [
      'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json#frag',
      'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json',
    ],
  ])('%s -> %s', (input, expected) => {
    expect(normaliseArtefactUrl(input)).toBe(expected);
  });
});

describe('findBundledArtefact', () => {
  it('returns the bundled v0.7.0 DPP schema for its published URL', async () => {
    const schema = (await findBundledArtefact(
      'https://untp.unece.org/artefacts/schema/v0.7.0/dpp/DigitalProductPassport.json',
    )) as { $id?: string; title?: string } | undefined;
    expect(schema).toBeDefined();
    expect(JSON.stringify(schema)).toContain('DigitalProductPassport');
  });

  it('matches the unified 0.7.0 context with or without its trailing slash', async () => {
    const withSlash = await findBundledArtefact('https://vocabulary.uncefact.org/untp/0.7.0/context/');
    const without = await findBundledArtefact('https://vocabulary.uncefact.org/untp/0.7.0/context');
    expect(withSlash).toBeDefined();
    expect(without).toBe(withSlash);
    expect(Object.keys(withSlash as object)).toContain('@context');
  });

  it('returns the VCDM v2 context and schema', async () => {
    const context = (await findBundledArtefact('https://www.w3.org/ns/credentials/v2')) as Record<string, unknown>;
    expect(Object.keys(context)).toContain('@context');
    expect(
      await findBundledArtefact(
        'https://w3c.github.io/vc-data-model/schema/verifiable-credential/verifiable-credential-schema.json',
      ),
    ).toBeDefined();
  });

  it('returns the legacy 0.6.0 DPP schema and context', async () => {
    expect(
      await findBundledArtefact('https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.6.0.json'),
    ).toBeDefined();
    expect(await findBundledArtefact('https://test.uncefact.org/vocabulary/untp/dpp/0.6.0/context/')).toBeDefined();
  });

  it('returns undefined for a version or host the bundle does not carry', async () => {
    expect(
      await findBundledArtefact('https://untp.unece.org/artefacts/schema/v9.9.9/dpp/DigitalProductPassport.json'),
    ).toBeUndefined();
    expect(
      await findBundledArtefact('https://aatp.foodagility.com/schema/aatp-dlp-schema-0.4.1-beta1.json'),
    ).toBeUndefined();
  });

  it('carries every artefact the manifest lists', async () => {
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(await readFile(new URL('../../artefacts/manifest.json', import.meta.url), 'utf8')) as {
      artefacts: { url: string }[];
    };
    expect(manifest.artefacts.length).toBeGreaterThanOrEqual(30);
    for (const { url } of manifest.artefacts) {
      expect(await findBundledArtefact(url)).toBeDefined();
    }
  });
});

describe('bundle integrity', () => {
  it('serves every artefact with the content hash the manifest records', async () => {
    const { readFile } = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const manifest = JSON.parse(await readFile(new URL('../../artefacts/manifest.json', import.meta.url), 'utf8')) as {
      artefacts: { url: string; sha256: string }[];
    };
    for (const { url, sha256 } of manifest.artefacts) {
      const served = await findBundledArtefact(url);
      expect(served).toBeDefined();
      expect(createHash('sha256').update(JSON.stringify(served)).digest('hex')).toBe(sha256);
    }
  });
});
