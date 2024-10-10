import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType, getLinkResolverIdentifier } from './linkResolver.service.js';
import { uploadData } from './storage.service.js';
import { IService } from './types/IService.js';
import { constructIdentifierString, generateUUID } from './utils/helpers.js';
import { issueVC } from './vckit.service.js';
import { ITraceabilityEvent, IDigitalFacilityRecordContext } from './types/index.js';
import { validateDigitalFacilityRecordContext } from './validateContext.js';

/**
 * Processes a digital facility record by issuing a verifiable credential, storing it in a storage service and registering a link resolver.
 * @param digitalFacilityRecordData The digital facility record to process, containing the digital facility record data
 * @param context The context to use for processing the digital facility record
 * @returns The result of processing the digital facility record
 */
export const processDigitalFacilityRecord: IService = async (
  digitalFacilityRecordData: ITraceabilityEvent,
  context: IDigitalFacilityRecordContext,
): Promise<any> => {
  const validationResult = validateDigitalFacilityRecordContext(context);
  if (!validationResult.ok) throw new Error(validationResult.value);

  if (!digitalFacilityRecordData.data) {
    throw new Error('digitalFacilityRecord data not found');
  }

  const { vckit, digitalFacilityRecord, dlr, storage, identifierKeyPath } = context;

  const identifierString = constructIdentifierString(digitalFacilityRecordData.data, identifierKeyPath);
  if (!identifierString) {
    throw new Error('Identifier not found');
  }

  const { identifier, qualifierPath } = getLinkResolverIdentifier(identifierString);

  const vc: VerifiableCredential = await issueVC({
    credentialSubject: digitalFacilityRecordData.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    issuer: vckit.issuer,
    context: digitalFacilityRecord.context,
    type: digitalFacilityRecord.type,
    restOfVC: {
      render: digitalFacilityRecord.renderTemplate,
    },
  });

  const vcUrl = await uploadData(storage, vc, generateUUID());

  const linkResolver = await registerLinkResolver(
    vcUrl,
    digitalFacilityRecord.dlrIdentificationKeyType,
    identifier,
    digitalFacilityRecord.dlrLinkTitle,
    LinkType.certificationLinkType,
    digitalFacilityRecord.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    qualifierPath,
    LinkType.certificationLinkType,
  );

  return { vc, linkResolver };
};
