import { buildPublishLinks } from './publish-credential';
import type { BuildPublishLinksOptions } from './publish-credential';
import type { StorageRecord } from '../../storage/types';

// Mock constructVerifyURL so we don't depend on window.location or URL construction details
jest.mock('../../utils/helpers', () => ({
  ...jest.requireActual('../../utils/helpers'),
  constructVerifyURL: jest.fn(
    ({ baseUrl, uri, digestMultibase }: { baseUrl: string; uri: string; digestMultibase: string }) => {
      return `${baseUrl}?q=${encodeURIComponent(JSON.stringify({ payload: { uri, digestMultibase } }))}`;
    },
  ),
}));
import { constructVerifyURL } from '../../utils/helpers';
const mockConstructVerifyURL = constructVerifyURL as jest.MockedFunction<typeof constructVerifyURL>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStorage(overrides: Partial<StorageRecord> = {}): StorageRecord {
  return {
    uri: 'https://storage.example.com/cred-123.json',
    digestMultibase: 'zabc123hash',
    externalId: 'test-external-id',
    mimeType: 'application/json',
    ...overrides,
  };
}

// ── buildPublishLinks ────────────────────────────────────────────────────────

describe('buildPublishLinks', () => {
  const storage = makeStorage();
  const linkTitle = 'Digital Product Passport';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns only 1 link (storage URI) when no verification URLs are provided', () => {
    const links = buildPublishLinks(storage, linkTitle);

    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      href: storage.uri,
      rel: 'gs1:sustainabilityInfo',
      type: 'application/json',
      title: linkTitle,
    });
  });

  it('returns 2 links (machine verification + storage URI) with only machineVerificationUrl', () => {
    const options: BuildPublishLinksOptions = {
      machineVerificationUrl: 'https://vckit.example.com/verify',
    };

    const links = buildPublishLinks(storage, linkTitle, options);

    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({
      href: 'https://vckit.example.com/verify',
      rel: 'gs1:verificationService',
      type: 'text/plain',
      title: 'VCKit verify service',
    });
    expect(links[1]).toEqual({
      href: storage.uri,
      rel: 'gs1:sustainabilityInfo',
      type: 'application/json',
      title: linkTitle,
    });
  });

  it('returns 2 links (storage URI + human verification) with only humanVerificationUrl', () => {
    const options: BuildPublishLinksOptions = {
      humanVerificationUrl: 'https://app.example.com/verify',
    };

    const links = buildPublishLinks(storage, linkTitle, options);

    expect(links).toHaveLength(2);
    expect(links[0]).toEqual({
      href: storage.uri,
      rel: 'gs1:sustainabilityInfo',
      type: 'application/json',
      title: linkTitle,
    });
    // Second link should be the human verification link
    expect(links[1].rel).toBe('gs1:sustainabilityInfo');
    expect(links[1].type).toBe('text/html');
    expect(links[1].title).toBe(linkTitle);
    expect(mockConstructVerifyURL).toHaveBeenCalledWith({
      baseUrl: 'https://app.example.com/verify',
      uri: storage.uri,
      digestMultibase: storage.digestMultibase,
    });
  });

  it('returns 3 links when both verification URLs are provided', () => {
    const options: BuildPublishLinksOptions = {
      machineVerificationUrl: 'https://vckit.example.com/verify',
      humanVerificationUrl: 'https://app.example.com/verify',
    };

    const links = buildPublishLinks(storage, linkTitle, options);

    expect(links).toHaveLength(3);
    // Order: machine verification, storage URI, human verification
    expect(links[0].rel).toBe('gs1:verificationService');
    expect(links[0].type).toBe('text/plain');
    expect(links[1].rel).toBe('gs1:sustainabilityInfo');
    expect(links[1].type).toBe('application/json');
    expect(links[2].rel).toBe('gs1:sustainabilityInfo');
    expect(links[2].type).toBe('text/html');
  });

  it('uses constructVerifyURL to build the human verification link href', () => {
    const options: BuildPublishLinksOptions = {
      humanVerificationUrl: 'https://app.example.com/verify',
    };

    buildPublishLinks(storage, linkTitle, options);

    expect(mockConstructVerifyURL).toHaveBeenCalledTimes(1);
    expect(mockConstructVerifyURL).toHaveBeenCalledWith({
      baseUrl: 'https://app.example.com/verify',
      uri: storage.uri,
      digestMultibase: storage.digestMultibase,
    });
  });

  it('uses custom linkType when provided', () => {
    const options: BuildPublishLinksOptions = {
      linkType: 'gs1:certificationInfo',
      humanVerificationUrl: 'https://app.example.com/verify',
    };

    const links = buildPublishLinks(storage, linkTitle, options);

    expect(links).toHaveLength(2);
    expect(links[0].rel).toBe('gs1:certificationInfo');
    expect(links[1].rel).toBe('gs1:certificationInfo');
  });

  it('returns only 1 link when options object is provided but both URLs are undefined', () => {
    const options: BuildPublishLinksOptions = {};

    const links = buildPublishLinks(storage, linkTitle, options);

    expect(links).toHaveLength(1);
    expect(links[0].href).toBe(storage.uri);
  });

  it('attaches hreflang, additionalRels, and public to the credential link only', () => {
    const options: BuildPublishLinksOptions = {
      machineVerificationUrl: 'https://vckit.example.com/verify',
      humanVerificationUrl: 'https://app.example.com/verify',
      hreflang: ['en', 'de'],
      additionalRels: ['gs1:certificationInfo'],
      public: true,
    };

    const links = buildPublishLinks(storage, linkTitle, options);

    expect(links).toHaveLength(3);
    expect(links[0]).not.toHaveProperty('hreflang');
    expect(links[0]).not.toHaveProperty('additionalRels');
    expect(links[0]).not.toHaveProperty('public');

    expect(links[1]).toMatchObject({
      href: storage.uri,
      hreflang: ['en', 'de'],
      additionalRels: ['gs1:certificationInfo'],
      public: true,
    });

    expect(links[2]).not.toHaveProperty('hreflang');
    expect(links[2]).not.toHaveProperty('additionalRels');
    expect(links[2]).not.toHaveProperty('public');
  });

  it('omits hreflang, additionalRels, and public when not provided', () => {
    const links = buildPublishLinks(storage, linkTitle);
    expect(links[0]).not.toHaveProperty('hreflang');
    expect(links[0]).not.toHaveProperty('additionalRels');
    expect(links[0]).not.toHaveProperty('public');
  });

  it('round-trips public: false distinctly from unset', () => {
    const links = buildPublishLinks(storage, linkTitle, { public: false });
    expect(links[0].public).toBe(false);
  });

  it('omits hreflang and additionalRels when arrays are empty', () => {
    const links = buildPublishLinks(storage, linkTitle, { hreflang: [], additionalRels: [] });
    expect(links[0]).not.toHaveProperty('hreflang');
    expect(links[0]).not.toHaveProperty('additionalRels');
  });
});
