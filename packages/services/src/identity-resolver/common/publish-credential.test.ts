import { buildPublishLinks } from './publish-credential';
import type { BuildPublishLinksOptions } from './publish-credential';
import type { StorageRecord } from '../../storage/types';

// Mock constructVerifyURL so we don't depend on window.location or URL construction details
jest.mock('../../utils/helpers', () => ({
  ...jest.requireActual('../../utils/helpers'),
  constructVerifyURL: jest.fn(({ baseUrl, uri, hash }: { baseUrl: string; uri: string; hash: string }) => {
    return `${baseUrl}/verify?q=${encodeURIComponent(JSON.stringify({ payload: { uri, hash } }))}`;
  }),
}));
import { constructVerifyURL } from '../../utils/helpers';
const mockConstructVerifyURL = constructVerifyURL as jest.MockedFunction<typeof constructVerifyURL>;

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStorage(overrides: Partial<StorageRecord> = {}): StorageRecord {
  return {
    uri: 'https://storage.example.com/cred-123.json',
    hash: 'abc123hash',
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
      humanVerificationUrl: 'https://app.example.com',
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
      baseUrl: 'https://app.example.com',
      uri: storage.uri,
      hash: storage.hash,
    });
  });

  it('returns 3 links when both verification URLs are provided', () => {
    const options: BuildPublishLinksOptions = {
      machineVerificationUrl: 'https://vckit.example.com/verify',
      humanVerificationUrl: 'https://app.example.com',
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
      humanVerificationUrl: 'https://app.example.com',
    };

    buildPublishLinks(storage, linkTitle, options);

    expect(mockConstructVerifyURL).toHaveBeenCalledTimes(1);
    expect(mockConstructVerifyURL).toHaveBeenCalledWith({
      baseUrl: 'https://app.example.com',
      uri: storage.uri,
      hash: storage.hash,
    });
  });

  it('returns only 1 link when options object is provided but both URLs are undefined', () => {
    const options: BuildPublishLinksOptions = {};

    const links = buildPublishLinks(storage, linkTitle, options);

    expect(links).toHaveLength(1);
    expect(links[0].href).toBe(storage.uri);
  });
});
