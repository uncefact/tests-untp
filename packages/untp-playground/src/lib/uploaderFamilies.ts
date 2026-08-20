import type { UploaderFamilyConfig } from '@/components/ArtefactUploader';
import type { TabId } from '../../constants';

/**
 * Per-tab uploader copy and URL behaviour, verbatim from the #676 contract. The tab declares
 * intent: an upload validates as the active tab's family, with no cross-family routing and no
 * auto-switching; detection only labels cards.
 */
export const UPLOADER_FAMILIES: Record<TabId, UploaderFamilyConfig> = {
  credentials: {
    heading: 'Add a credential',
    dropzoneSubtitle: 'Verifiable Credential (JSON / JWT)',
    divider: 'or paste a URL',
    urlPlaceholder: 'https://example.org/credential.json',
    urlAction: 'Fetch',
    urlMode: 'fetch',
    helper:
      'Validated as a verifiable credential against the six-step pipeline. URLs are fetched server-side; type and version are detected automatically.',
  },
  schemes: {
    heading: 'Add a conformity scheme',
    dropzoneSubtitle: 'Conformity Scheme (JSON-LD)',
    divider: 'or paste a URL',
    urlPlaceholder: 'https://example.org/scheme.jsonld',
    urlAction: 'Fetch',
    urlMode: 'fetch',
    // The ticket's draft sentence here ("Duplicate ids replace the existing card") contradicts
    // ADR-041: scheme identity is the content hash, so identical content replaces and revised
    // content adds a card. The copy states the shipped behaviour.
    helper:
      'Validated as a Conformity Scheme: version detection, schema validation and JSON-LD context checks. Re-uploading the same document replaces the existing card.',
  },
  linksets: {
    heading: 'Add a link set',
    dropzoneSubtitle: 'Link Set (JSON)',
    divider: 'or resolve from an identity resolver',
    urlPlaceholder: 'https://resolver.example.org/01/09520123456788',
    urlAction: 'Resolve',
    urlMode: 'resolve',
    // The ticket's draft sentence promised present-tense schema validation, but that step is a
    // pending stub until link set validation ships; the copy states what the app does today.
    helper:
      'Point at an identity resolver. The playground requests the link set with ?linkType=all and checks the response is an RFC 9264 link set. Schema validation is coming in v0.4.',
  },
};
