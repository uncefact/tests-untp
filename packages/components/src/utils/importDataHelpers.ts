import { verifyVC, decodeEnvelopedVC } from '@mock-app/services';
import { VerifiableCredential } from '@vckit/core-types';
import JSONPointer from 'jsonpointer';
import { IVCContext } from '../types/common.types';

export const processVerifiableCredentialData = async (data: any, vcContext: IVCContext, credentialPath?: string) => {
  try {
    let vc: VerifiableCredential = data as VerifiableCredential;
    if (credentialPath) {
      vc = JSONPointer.get(data, credentialPath);
    }

    const { vckitAPIUrl, headers } = vcContext || {};

    const result = await verifyVC(vc, vckitAPIUrl, headers);
    if (!result.verified) {
      throw new Error('Invalid Verifiable Credential!');
    }
    const decodedEnvelopedVC = decodeEnvelopedVC(vc);
    if (decodedEnvelopedVC) {
      const vcData = { vc, decodedEnvelopedVC };
      if (credentialPath) {
        JSONPointer.set(data, credentialPath, vcData);
      } else {
        data = vcData;
      }
    }

    return data;
  } catch (error: any) {
    throw new Error(error);
  }
};
