import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import { ExternalContentKind } from '@/lib/prisma/generated';
import type { OpenedContent } from './external-artefact';

/**
 * Returns the identity of an opened credential's signed artefact, or
 * undefined for a body that is not a credential. The envelope is
 * deliberately excluded, so different serialisations of the same signed JWT
 * have the same identity (#956, D1).
 *
 * The segment digested is the one the reading already accepted, carried on
 * the content as `acceptedJwt`, so the identity and the decode can never
 * disagree about which bytes the signature covers.
 */
export async function contentDigestOf(content: OpenedContent): Promise<string | undefined> {
  if (content.kind !== ExternalContentKind.CREDENTIAL) return undefined;

  return (
    await MultibaseDigest.fromText(content.acceptedJwt, {
      algorithm: 'sha2-256',
      base: 'base58btc',
    })
  ).toString();
}
