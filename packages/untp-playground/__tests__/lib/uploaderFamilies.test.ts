import { UPLOADER_FAMILIES } from '@/lib/uploaderFamilies';

// Pins the production per-tab table to the #676 contract's copy, so a drifted string fails here
// rather than shipping silently. The component tests prove rendering; this proves the values.
describe('UPLOADER_FAMILIES (#676 contract table)', () => {
  it('carries the Credentials tab copy and fetch mode', () => {
    expect(UPLOADER_FAMILIES.credentials).toEqual({
      heading: 'Add a credential',
      dropzoneSubtitle: 'Verifiable Credential (JSON / JWT)',
      divider: 'or paste a URL',
      urlPlaceholder: 'https://example.org/credential.json',
      urlAction: 'Fetch',
      urlMode: 'fetch',
      helper:
        'Validated as a verifiable credential against the six-step pipeline. URLs are fetched server-side; type and version are detected automatically.',
    });
  });

  it('carries the Conformity Schemes tab copy and fetch mode', () => {
    expect(UPLOADER_FAMILIES.schemes).toEqual({
      heading: 'Add a conformity scheme',
      dropzoneSubtitle: 'Conformity Scheme (JSON-LD)',
      divider: 'or paste a URL',
      urlPlaceholder: 'https://example.org/scheme.jsonld',
      urlAction: 'Fetch',
      urlMode: 'fetch',
      // Deliberately not the ticket's draft sentence ("Duplicate ids replace the existing card"):
      // scheme identity is the content hash per ADR-041, and the helper states that behaviour.
      helper:
        'Validated as a Conformity Scheme: version detection, schema validation and JSON-LD context checks. Re-uploading the same document replaces the existing card.',
    });
  });

  it('carries the Link Sets tab copy and resolve mode', () => {
    expect(UPLOADER_FAMILIES.linksets).toEqual({
      heading: 'Add a link set',
      dropzoneSubtitle: 'Link Set (JSON)',
      divider: 'or resolve from an identity resolver',
      urlPlaceholder: 'https://resolver.example.org/01/09520123456788',
      urlAction: 'Resolve',
      urlMode: 'resolve',
      // Deliberately not the ticket's draft sentence: schema validation is a pending stub, so
      // the helper states what the app does today.
      helper:
        'Point at an identity resolver. The playground requests the link set with ?linkType=all and checks the response is an RFC 9264 link set. Schema validation is coming in v0.4.',
    });
  });
});
