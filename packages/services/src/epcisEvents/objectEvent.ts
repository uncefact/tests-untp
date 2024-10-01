import { VerifiableCredential } from '@vckit/core-types';
import {
  registerLinkResolver,
  LinkType,
  getLinkResolverIdentifier,
  getLinkResolverIdentifierFromURI,
} from '../linkResolver.service.js';
import { getStorageServiceLink } from '../storage.service.js';
import { IService } from '../types/IService.js';
import { constructIdentifierString, constructObject, generateUUID } from '../utils/helpers.js';
import { issueVC } from '../vckit.service.js';
import { IObjectEvent, IObjectEventContext } from './types';
import { validateObjectEventContext } from './validateContext.js';

/**
 * Processes an object event by issuing a verifiable credential, storing it in a storage service and registering a link resolver. After that it will update the DPPs to attach the object event to the VC.
 * @param objectEvent The object event to process, containing the object event data, which is set the action for the VC, and the DPPs which will be linked with the object event
 * @param context The context to use for processing the object event
 * @returns The result of processing the object event
 */
export const processObjectEvent: IService = async (
  objectEvent: IObjectEvent,
  context: IObjectEventContext,
): Promise<any> => {
  const validationResult = validateObjectEventContext(context);
  if (!validationResult.ok) throw new Error(validationResult.value);

  if (!objectEvent.data) {
    throw new Error('Object event data not found');
  }
  if (!objectEvent.dppCredentialsAndLinkResolvers) {
    throw new Error('DPP credentials and link resolvers not found');
  }

  const { vckit, epcisObjectEvent, dlr, storage, identifierKeyPath, dpp, dppCredential } = context;

  const transactionIdentifier = constructIdentifierString(objectEvent.data, identifierKeyPath);
  if (!transactionIdentifier) {
    throw new Error('Identifier not found');
  }

  const { identifier: objectEventIdentifier, qualifierPath: objectEventQualifierPath } =
    getLinkResolverIdentifier(transactionIdentifier);

  const objectEventVc: VerifiableCredential = await issueVC({
    credentialSubject: objectEvent.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    issuer: vckit.issuer,
    context: epcisObjectEvent.context,
    type: epcisObjectEvent.type,
    restOfVC: {
      render: epcisObjectEvent.renderTemplate,
    },
  });

  const objectEventVcUrl = await getStorageServiceLink(
    storage,
    objectEventVc,
    `${objectEventIdentifier}/${generateUUID()}`,
  );

  const objectEventLinkResolver = await registerLinkResolver(
    objectEventVcUrl,
    epcisObjectEvent.dlrIdentificationKeyType,
    objectEventIdentifier,
    epcisObjectEvent.dlrLinkTitle,
    LinkType.epcisLinkType,
    epcisObjectEvent.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    objectEventQualifierPath,
    LinkType.epcisLinkType,
  );
  const dppCredentialsAndLinkResolvers = Object.values(objectEvent.dppCredentialsAndLinkResolvers);
  const dppIdentifiers = Object.keys(objectEvent.dppCredentialsAndLinkResolvers);

  const objectEventVcData = {
    vc: objectEventVc,
    linkResolver: objectEventLinkResolver,
  };

  const newDppCredentialsAndLinkResolvers = await Promise.all(
    dppCredentialsAndLinkResolvers.map(async ({ vc: currentDppVC, linkResolver }) => {
      const _currentDppVC = { ...currentDppVC };
      delete _currentDppVC.issuer;

      const dppCredentialSubject = constructObject(_currentDppVC.credentialSubject, objectEventVcData, dppCredential);

      const createdDppVc: VerifiableCredential = await issueVC({
        credentialSubject: dppCredentialSubject,
        vcKitAPIUrl: vckit.vckitAPIUrl,
        issuer: vckit.issuer,
        context: _currentDppVC.context,
        type: _currentDppVC.type,
        restOfVC: { ..._currentDppVC },
      });

      const { identifier: dppIdentifier, qualifierPath: dppQualifierPath } =
        getLinkResolverIdentifierFromURI(linkResolver);

      const dppVcUrl = await getStorageServiceLink(storage, createdDppVc, `${dppIdentifier}/${dppQualifierPath}`);

      const dppLinkResolver = await registerLinkResolver(
        dppVcUrl,
        dpp.dlrIdentificationKeyType,
        dppIdentifier,
        dpp.dlrLinkTitle,
        LinkType.certificationLinkType,
        dpp.dlrVerificationPage,
        dlr.dlrAPIUrl,
        dlr.dlrAPIKey,
        dlr.namespace,
        dppQualifierPath,
        LinkType.certificationLinkType,
      );

      return { vc: createdDppVc, linkResolver: dppLinkResolver };
    }),
  );

  const dpps = dppIdentifiers.reduce(
    (dppsMap, dppIdentifier, index) => {
      dppsMap[dppIdentifier] = newDppCredentialsAndLinkResolvers[index];
      return dppsMap;
    },
    {} as { [key: string]: { vc: any; linkResolver: string } },
  );

  return { vc: objectEventVc, linkResolver: objectEventLinkResolver, dpps };
};
