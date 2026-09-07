/**
 * @jest-environment node
 */
// The real multibase digest utility, in place of the stub the RI's Jest
// config maps this specifier to. The stub ignores the algorithm and the base
// it is handed, so a vector taken against it would hold whatever the
// production call passed. The vectors below are the values the packaged
// utility produces, so changing either option changes them.
jest.mock('@uncefact/untp-utils/multibase-digest', () =>
  jest.requireActual('../../../../untp-utils/src/multibase-digest/index.ts'),
);

import { decodeJwt } from 'jose';
import { ExternalContentKind } from '@/lib/prisma/generated';
import { contentDigestOf } from './content-digest';
import { readExternalArtefact } from './external-artefact';
import type { OpenedContent } from './external-artefact';

// This runtime maps jose to a stub, and the reading under test needs the real
// payload decode, which is what tells a signed credential from other JSON.
beforeAll(() => {
  (decodeJwt as jest.Mock).mockImplementation((jwt: string) =>
    JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString()),
  );
});

const SEGMENT = 'eyJhbGciOiJFUzI1NiJ9.eyJpc3MiOiJkaWQ6d2ViOmV4YW1wbGUuY29tIn0.c2lnbmF0dXJl';

/**
 * The sha2-256 multihash of {@link SEGMENT}, base58btc. Recomputing it means
 * running `MultibaseDigest.fromData` over those bytes with the two options
 * `contentDigestOf` passes. A different algorithm or base gives a different
 * string, which is the regression this vector exists to catch.
 */
const SEGMENT_DIGEST = 'zQmNm1WVEofWeBPTTaFWtFNbdjSXcqiA8Hn3wn6M9739JF7';

function credential(acceptedJwt: string): OpenedContent {
  return {
    kind: ExternalContentKind.CREDENTIAL,
    bytes: new Uint8Array(),
    credential: { id: `data:application/vc+jwt,${acceptedJwt}`, type: 'EnvelopedVerifiableCredential' },
    decoded: {},
    acceptedJwt,
  } as OpenedContent;
}

function objectContent(): OpenedContent {
  return { kind: ExternalContentKind.JSON_OBJECT, bytes: new Uint8Array() };
}

function envelope(jwt: string, extra: Record<string, unknown> = {}): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: `data:application/vc+jwt,${jwt}`,
      ...extra,
    }),
  );
}

describe('contentDigestOf', () => {
  it('digests the accepted JWT segment as a base58btc sha2-256 multihash', async () => {
    await expect(contentDigestOf(credential(SEGMENT))).resolves.toBe(SEGMENT_DIGEST);
  });

  it('changes when the signed JWT changes', async () => {
    await expect(contentDigestOf(credential('header.payload.one'))).resolves.not.toBe(
      await contentDigestOf(credential('header.payload.two')),
    );
  });

  it('does not assign a content identity to non-credential content', async () => {
    await expect(contentDigestOf(objectContent())).resolves.toBeUndefined();
  });
});

describe('content identity across envelope serialisations', () => {
  it('gives two serialisations of one signed credential the same identity', async () => {
    // Fails if the identity ever takes in the envelope rather than the
    // segment the decoder accepted. These two bodies differ byte for byte.
    const plain = readExternalArtefact(envelope(SEGMENT), undefined);
    const decorated = readExternalArtefact(envelope(SEGMENT, { name: 'a second serialisation' }), undefined);

    expect(plain.outcome).toBe('opened');
    expect(decorated.outcome).toBe('opened');
    if (plain.outcome !== 'opened' || decorated.outcome !== 'opened') return;

    await expect(contentDigestOf(plain.content)).resolves.toBe(SEGMENT_DIGEST);
    await expect(contentDigestOf(decorated.content)).resolves.toBe(SEGMENT_DIGEST);
  });
});
