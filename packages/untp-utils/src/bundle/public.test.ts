import {
  bundledContext,
  bundledLinkSetSchema,
  bundledSchema,
  bundledUntpVersions,
  bundledVcdmContext,
  bundledVcdmSchema,
  findBundledArtefact,
  loadBundledArtefacts,
} from './public.js';

describe('bundled-artefacts public entry', () => {
  it('exposes every bundled artefact keyed by its published URL', async () => {
    const all = await loadBundledArtefacts();
    expect(all.size).toBeGreaterThanOrEqual(30);
    expect(all.has('https://www.w3.org/ns/credentials/v2')).toBe(true);
    expect(all.has('https://untp.unece.org/artefacts/schema/v0.7.0/idr/LinksetSchema.json')).toBe(true);
  });

  it('lets a consumer read a schema without the network', async () => {
    const linkset = (await findBundledArtefact(
      'https://untp.unece.org/artefacts/schema/v0.7.0/idr/LinksetSchema.json',
    )) as { title?: string };
    expect(linkset.title).toMatch(/linkset/i);
  });

  it('lists the UNTP versions it carries', async () => {
    expect(await bundledUntpVersions()).toEqual(['0.6.0', '0.6.1', '0.7.0']);
  });

  it('returns a schema and context by credential type and version', async () => {
    const legacy = await bundledSchema('DigitalProductPassport', '0.6.0');
    expect(JSON.stringify(legacy)).toContain('DigitalProductPassport');
    const legacyContext = (await bundledContext('DigitalProductPassport', '0.6.0')) as Record<string, unknown>;
    expect(Object.keys(legacyContext)).toContain('@context');
    const unified = await bundledContext('DigitalConformityCredential', '0.7.0');
    expect(unified).toBe(await bundledContext('DigitalProductPassport', '0.7.0'));
    expect(await bundledSchema('DigitalProductPassport', '9.9.9')).toBeUndefined();
  });

  it('rejects an unknown credential type the way the URL builder does', async () => {
    await expect(bundledSchema('NotAType', '0.7.0')).rejects.toThrow(/Unknown UNTP artefact type/);
  });

  it('returns the link set schema and the VCDM pair by version', async () => {
    expect(await bundledLinkSetSchema('0.7.0')).toBeDefined();
    expect(await bundledLinkSetSchema('0.6.0')).toBeUndefined();
    expect(Object.keys((await bundledVcdmContext('2')) as object)).toContain('@context');
    expect(await bundledVcdmSchema('2')).toBeDefined();
  });
});
