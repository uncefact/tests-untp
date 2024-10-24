import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType, getLinkResolverIdentifier } from '../linkResolver.service.js';
import { uploadData } from '../storage.service.js';
import { IService } from '../types/IService.js';
import { constructIdentifierString, generateUUID } from '../utils/helpers.js';
import { issueVC } from '../vckit.service.js';
import { ITraceabilityEvent, IObjectEventContext } from '../types/index.js';
import { validateObjectEventContext } from '../validateContext.js';

/**
 * Processes an object event by issuing a verifiable credential, storing it in a storage service and registering a link resolver.
 * @param objectEvent The object event to process, containing the object event data
 * @param context The context to use for processing the object event
 * @returns The result of processing the object event
 */
export const processObjectEvent: IService = async (
  objectEvent: ITraceabilityEvent,
  context: IObjectEventContext,
): Promise<any> => {
  const validationResult = validateObjectEventContext(context);
  if (!validationResult.ok) throw new Error(validationResult.value);

  if (!objectEvent.data) {
    throw new Error('Object event data not found');
  }

  const { vckit, epcisObjectEvent, dlr, storage, identifierKeyPath } = context;

  const objectIdentifier = constructIdentifierString(objectEvent.data, identifierKeyPath);
  if (!objectIdentifier) {
    throw new Error('Identifier not found');
  }

  const { identifier: objectEventIdentifier, qualifierPath: objectEventQualifierPath } =
    getLinkResolverIdentifier(objectIdentifier);

  const objectEventVc: VerifiableCredential = await issueVC({
    credentialSubject: objectEvent.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    headers: vckit.headers,
    issuer: vckit.issuer,
    context: epcisObjectEvent.context,
    type: epcisObjectEvent.type,
    restOfVC: {
      render: epcisObjectEvent.renderTemplate,
    },
  });

  const objectEventVcUrl = await uploadData(storage, objectEventVc, generateUUID());

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

  return { vc: objectEventVc, linkResolver: objectEventLinkResolver };
};
