import { UnsignedCredential, VerifiableCredential } from '@vckit/core-types';

export interface CredentialComponentProps {
  credential: VerifiableCredential;
  decodedEnvelopedVC?: UnsignedCredential | null;
}
