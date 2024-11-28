import { VerifiableCredential } from '@vckit/core-types';
import { registerLinkResolver, LinkType } from './linkResolver.service.js';
import { uploadData } from './storage.service.js';
import { IService } from './types/IService.js';
import { constructVerifyURL, generateUUID } from './utils/helpers.js';
import { decodeEnvelopedVC, issueVC } from './vckit.service.js';
import { ITraceabilityEvent, IDigitalFacilityRecordContext } from './types/index.js';
import { validateDigitalFacilityRecordContext } from './validateContext.js';
import { constructIdentifierData, constructQualifierPath } from './identifierSchemes/identifierSchemeServices.js';

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

  const aiData = constructIdentifierData(identifierKeyPath, digitalFacilityRecordData.data);
  if (!aiData.primary.ai || !aiData.primary.value) throw new Error('Identifier not found');
  const qualifierPath = constructQualifierPath(aiData.qualifiers);
  const identifier = aiData.primary.value;

  const credentialId = generateUUID();

  const vc: VerifiableCredential = await issueVC({
    credentialSubject: digitalFacilityRecordData.data,
    vcKitAPIUrl: vckit.vckitAPIUrl,
    headers: vckit.headers,
    issuer: vckit.issuer,
    context: digitalFacilityRecord.context,
    type: digitalFacilityRecord.type,
    restOfVC: {
      id: `urn:uuid:${credentialId}`,
      render: digitalFacilityRecord.renderTemplate,
    },
  });

  const decodedEnvelopedVC = decodeEnvelopedVC(vc);

  const { uri, key, hash } = await uploadData(storage, vc, credentialId);
  const verifyURL = constructVerifyURL({ uri, key, hash });

  const linkResolver = await registerLinkResolver(
    uri,
    verifyURL,
    aiData.primary.ai,
    identifier,
    digitalFacilityRecord.dlrLinkTitle,
    LinkType.locationInfo,
    digitalFacilityRecord.dlrVerificationPage,
    dlr.dlrAPIUrl,
    dlr.dlrAPIKey,
    dlr.namespace,
    qualifierPath,
    LinkType.locationInfo,
  );

  return { vc, decodedEnvelopedVC, linkResolver };
};
