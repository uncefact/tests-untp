import {
  isUntpCredentialLink,
  linkedCredentialRows,
  linkSetKey,
  linkSetSubtitle,
  linkSetTitle,
} from '@/lib/linkSetCollection';
import type { StoredLinkSet } from '@/types';

const stored = (decoded: Record<string, unknown>, source?: StoredLinkSet['source']): StoredLinkSet => ({
  original: decoded,
  decoded,
  source,
});

describe('linkSetKey', () => {
  it('keys a url-sourced link set by that URL, query included (the resolver stores the request URL here)', () => {
    expect(linkSetKey({ kind: 'url', url: 'https://r.example.org/01/1?linkType=all' })).toBe(
      'https://r.example.org/01/1?linkType=all',
    );
  });

  it('keys an uploaded link set by its filename', () => {
    expect(linkSetKey({ kind: 'file', filename: 'linkset.json' })).toBe('linkset.json');
  });
});

describe('linkSetTitle', () => {
  it('strips the scheme and query from a resolver URL', () => {
    const title = linkSetTitle(
      stored({ linkset: [] }, { kind: 'url', url: 'https://resolver.example.org/01/09520123456788?linkType=all' }),
    );
    expect(title).toBe('resolver.example.org/01/09520123456788');
  });

  it('falls back to the filename for an uploaded link set', () => {
    expect(linkSetTitle(stored({ linkset: [] }, { kind: 'file', filename: 'my-linkset.json' }))).toBe(
      'my-linkset.json',
    );
  });

  it('falls back to the first anchor when there is no source', () => {
    expect(linkSetTitle(stored({ linkset: [{ anchor: 'https://id.example.org/01/1' }] }))).toBe(
      'https://id.example.org/01/1',
    );
  });
});

describe('linkSetSubtitle', () => {
  it('is the family label', () => {
    expect(linkSetSubtitle()).toBe('Link Set');
  });
});

describe('isUntpCredentialLink', () => {
  it('accepts the UNTP-registered relations, bare or URI-qualified', () => {
    expect(isUntpCredentialLink('dpp', undefined)).toBe(true);
    expect(isUntpCredentialLink('https://test.uncefact.org/voc/untp/dcc', undefined)).toBe(true);
    expect(isUntpCredentialLink('DFR', undefined)).toBe(true);
    expect(isUntpCredentialLink('https://example.org/voc/dte', undefined)).toBe(true);
  });

  it('accepts the CURIE forms the UNTP v0.7 IDR API and the Pyx IDR adapter use', () => {
    expect(isUntpCredentialLink('untp:dpp', undefined)).toBe(true);
    expect(isUntpCredentialLink('untp:dcc', 'application/json')).toBe(true);
    expect(isUntpCredentialLink('untp:dfr', undefined)).toBe(true);
    expect(isUntpCredentialLink('untp:dte', undefined)).toBe(true);
  });

  it('accepts fragment-qualified and trailing-separator relation URIs', () => {
    expect(isUntpCredentialLink('https://test.uncefact.org/voc/untp#dpp', undefined)).toBe(true);
    expect(isUntpCredentialLink('https://test.uncefact.org/voc/untp/dcc/', undefined)).toBe(true);
  });

  it('accepts VC media types carrying parameters', () => {
    expect(isUntpCredentialLink('pip', 'application/vc+ld+json; charset=utf-8')).toBe(true);
  });

  it('accepts verifiable-credential media types regardless of relation', () => {
    expect(isUntpCredentialLink('pip', 'application/vc+jwt')).toBe(true);
    expect(isUntpCredentialLink('https://ref.gs1.org/voc/certificationInfo', 'application/vc+ld+json')).toBe(true);
  });

  it('treats a text/html target under a credential relation as the viewing page, not the credential', () => {
    expect(isUntpCredentialLink('dcc', 'text/html')).toBe(false);
    expect(isUntpCredentialLink('https://idr.example.org/api/v4/voc/dfr', 'text/html')).toBe(false);
    // The same relation with the document target still qualifies.
    expect(isUntpCredentialLink('https://idr.example.org/api/v4/voc/dfr', 'application/json')).toBe(true);
  });

  it('rejects other relations and media types', () => {
    expect(isUntpCredentialLink('pip', 'text/html')).toBe(false);
    expect(isUntpCredentialLink('https://ref.gs1.org/voc/hasRetailers', undefined)).toBe(false);
    expect(isUntpCredentialLink('https://example.org/voc/dppx', 'application/json')).toBe(false);
  });
});

describe('linkedCredentialRows', () => {
  it('flattens link relations into labelled rows, preferring title over type', () => {
    const rows = linkedCredentialRows({
      linkset: [
        {
          anchor: 'https://id.example.org/01/1',
          'https://ref.gs1.org/voc/sustainabilityInfo': [
            { href: 'https://x.example.org/dpp.json', title: 'Digital Product Passport', type: 'application/json' },
          ],
          'https://ref.gs1.org/voc/certificationInfo': [
            { href: 'https://x.example.org/dcc.json', type: 'application/json' },
          ],
        },
      ],
    });
    expect(rows).toEqual([
      {
        label: 'Digital Product Passport',
        href: 'https://x.example.org/dpp.json',
        credential: false,
        encrypted: false,
      },
      { label: 'application/json', href: 'https://x.example.org/dcc.json', credential: false, encrypted: false },
    ]);
  });

  it('labels a bare href by its final path segment', () => {
    const rows = linkedCredentialRows({
      linkset: [{ rel: [{ href: 'https://x.example.org/creds/dte-88.json' }] }],
    });
    expect(rows).toEqual([
      { label: 'dte-88.json', href: 'https://x.example.org/creds/dte-88.json', credential: false, encrypted: false },
    ]);
  });

  it('skips the anchor member and targets without an href', () => {
    const rows = linkedCredentialRows({
      linkset: [{ anchor: 'https://id.example.org/01/1', rel: [{ title: 'no href' }] }],
    });
    expect(rows).toEqual([]);
  });

  it('returns no rows for a document without a linkset array', () => {
    expect(linkedCredentialRows({})).toEqual([]);
  });
});

describe('linkedCredentialRows empty href (RFC 9264 self-reference)', () => {
  it('skips an empty href silently: it names the link set itself, not a linked credential', () => {
    const rows = linkedCredentialRows({
      linkset: [{ anchor: 'https://id.example.org/01/1', describedby: [{ href: '' }] }],
    });
    expect(rows).toEqual([]);
  });
});

describe('encrypted target signal (#812, UNTP Secure Targets)', () => {
  const rowsFor = (target: Record<string, unknown>) =>
    linkedCredentialRows({ linkset: [{ dpp: [{ href: 'https://x.example.org/c.json', ...target }] }] });

  it.each([
    ['spec string form', { encryptionMethod: 'AES-128' }, true],
    ['RFC 9264 array form', { encryptionMethod: ['AES-128'] }, true],
    ['none is not encryption', { encryptionMethod: 'none' }, false],
    ['whitespace only', { encryptionMethod: '   ' }, false],
    ['empty array', { encryptionMethod: [] }, false],
    ['accessRole alone is authorisation, not encryption', { accessRole: ['untp:accessRole#Owner'] }, false],
    ['the retired boolean flag', { encrypted: true }, false],
    ['non-string member', { encryptionMethod: [42] }, false],
  ])('%s -> encrypted %s', (_name, target, expected) => {
    expect(rowsFor(target)[0].encrypted).toBe(expected);
  });
});
