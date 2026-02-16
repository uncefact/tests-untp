import { decodeJwt } from 'jose';
import type { EnvelopedVerifiableCredential, UNTPVerifiableCredential } from '../types.js';
import { VcDecodeError } from '../errors.js';

/**
 * Decodes an enveloped verifiable credential by extracting and parsing the
 * JWT payload. This is adapter-agnostic since all UNTP enveloped credentials
 * use the same JWT envelope format regardless of which VC service signed them.
 *
 * @param credential - The enveloped credential to decode.
 * @returns The decoded unsigned credential content.
 * @throws {VcDecodeError} If the credential is null, not enveloped, or has an invalid JWT.
 */
export function decodeCredential(credential: EnvelopedVerifiableCredential): UNTPVerifiableCredential {
  if (!credential) throw new VcDecodeError('Credential is required');

  if (credential.type !== 'EnvelopedVerifiableCredential') {
    throw new VcDecodeError('Credential is not an EnvelopedVerifiableCredential');
  }

  const encodedCredential = credential.id?.split(',')[1];
  if (!encodedCredential) {
    throw new VcDecodeError('Invalid enveloped credential format: missing encoded data');
  }

  try {
    return decodeJwt(encodedCredential) as UNTPVerifiableCredential;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown error';
    throw new VcDecodeError(detail);
  }
}
