import { CredentialSubject, VerifiableCredential } from '@vckit/core-types';
import { IService } from '../types/index.js';
import { issueVC } from '../vckit.service.js';
import { IContext } from './types.js';
import { getIdentifierByObjectKeyPaths } from './helpers.js';
import { uploadJson } from '../storage.service.js';
import { generateUUID } from '../utils/helpers.js';
import {
  ILinkResolver,
  ILinkResponse,
  IdentificationKeyType,
  LinkType,
  MimeType,
  createLinkResolver,
} from '../linkResolver.service.js';

export interface ITransactionEvent {
  data: CredentialSubject;
}

export const processTransactionEvent: IService = async (transactionEvent: ITransactionEvent, context: IContext): Promise<VerifiableCredential> => {
  const { data: credentialSubject } = transactionEvent;
  const { identifierKeyPaths, vckit, storage, dlr } = context;

  const identifier = getIdentifierByObjectKeyPaths(credentialSubject, identifierKeyPaths);
  if (!identifier) {
    throw new Error('Identifier not found');
  }

  const vc: VerifiableCredential = await issueVC({
    credentialSubject,
    context: vckit.context,
    issuer: vckit.issuer,
    type: vckit.type,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    render: vckit.renderTemplate,
  });

  const vcUrl = await uploadJson({
    filename: `${identifier}/${generateUUID()}`,
    json: vc,
    bucket: storage.bucket,
    storageAPIUrl: storage.storageAPIUrl,
  });

  await registerLinkResolver({
    url: vcUrl,
    identificationKeyType: IdentificationKeyType[dlr.identificationKeyType as keyof typeof IdentificationKeyType],
    identificationKey: identifier,
    linkTitle: dlr.linkTitle,
    verificationPage: dlr.verificationPage,
    dlrAPIUrl: dlr.dlrAPIUrl,
    dlrAPIKey: dlr.dlrAPIKey,
  });


  return vc;
};

const registerLinkResolver = async ({
    url,
    identificationKeyType,
    identificationKey,
    linkTitle,
    verificationPage,
    dlrAPIUrl,
    dlrAPIKey,
  }: {
    url: string,
    identificationKeyType: IdentificationKeyType,
    identificationKey: string,
    linkTitle: string,
    verificationPage: string,
    dlrAPIUrl: string,
    dlrAPIKey: string
  }): Promise<string> => {
  const linkResolver: ILinkResolver = {
    identificationKeyType,
    identificationKey: identificationKey,
    itemDescription: linkTitle,
  };
  const payloadQuery = encodeURIComponent(JSON.stringify({ payload: { uri: url } }));
  const payloadQueryString = `q=${payloadQuery}`;
  const verificationPassportPage = `${verificationPage}/?${payloadQueryString}`;

  const linkResponses: ILinkResponse[] = [
    {
      linkTitle,
      linkType: LinkType.epcisLinkType,
      targetUrl: url,
      mimeType: MimeType.applicationJson,
    },
    {
      linkTitle,
      linkType: LinkType.epcisLinkType,
      targetUrl: verificationPassportPage,
      mimeType: MimeType.textHtml,
      defaultLinkType: true,
      defaultIanaLanguage: true,
      defaultMimeType: true,
    },
  ];

  const linkResolverUrl = await createLinkResolver({
    linkResolver,
    linkResponses,
    qualifierPath: '/',
    dlrAPIUrl,
    dlrAPIKey,
    queryString: payloadQueryString,
  });

  return linkResolverUrl;
};
