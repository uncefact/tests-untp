import { VerifiableCredential } from '@vckit/core-types';
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

export const processObjectEvent: IService = async (data: any, context: IContext): Promise<any> => {
  try {
    const vckitContext = context.vckit;
    const dppContext = context.dpp;
    const restOfVC = { render: dppContext.renderTemplate };
    const vc: VerifiableCredential = await issueVC({
      context: dppContext.context,
      credentialSubject: data.data,
      issuer: vckitContext.issuer,
      type: [...dppContext.type],
      vcKitAPIUrl: vckitContext.vckitAPIUrl,
      ...restOfVC,
    });

    const identifier = getIdentifierByObjectKeyPaths(data.data, context.identifierKeyPaths) as string;
    if (!identifier) throw new Error('Identifier not found');

    const storageContext = context.storage;

    const vcUrl = await uploadJson({
      filename: `${identifier}/${generateUUID()}`,
      json: vc,
      bucket: storageContext.bucket,
      storageAPIUrl: storageContext.storageAPIUrl,
    });

    const linkResolverContext = context.dlr;
    await registerLinkResolver(
      vcUrl,
      dppContext.dlrIdentificationKeyType,
      identifier,
      dppContext.linkTitle,
      dppContext.verificationPage,
      linkResolverContext.dlrAPIUrl,
      linkResolverContext.dlrAPIKey,
    );

    return vc;
  } catch (error: any) {
    throw new Error(error);
  }
};

const registerLinkResolver = async (
  url: string,
  identificationKeyType: IdentificationKeyType,
  identificationKey: string,
  linkTitle: string,
  verificationPage: string,
  dlrAPIUrl: string,
  dlrAPIKey: string,
) => {
  const linkResolver: ILinkResolver = {
    identificationKeyType,
    identificationKey: identificationKey,
    itemDescription: linkTitle,
  };
  const query = encodeURIComponent(JSON.stringify({ payload: { uri: url } }));
  const queryString = `q=${query}`;
  const verificationPassportPage = `${verificationPage}/?${queryString}`;
  const linkResponses: ILinkResponse[] = [
    {
      linkType: LinkType.verificationLinkType,
      linkTitle: 'VCKit verify service',
      targetUrl: verificationPage,
      mimeType: MimeType.textPlain,
    },
    {
      linkType: LinkType.certificationLinkType,
      linkTitle: linkTitle,
      targetUrl: url,
      mimeType: MimeType.applicationJson,
    },
    {
      linkType: LinkType.certificationLinkType,
      linkTitle: linkTitle,
      targetUrl: verificationPassportPage,
      mimeType: MimeType.textHtml,
      defaultLinkType: true,
      defaultIanaLanguage: true,
      defaultMimeType: true,
    },
  ];

  await createLinkResolver({
    dlrAPIUrl,
    linkResolver,
    linkResponses,
    queryString,
    dlrAPIKey,
    qualifierPath: '/',
  });
};
