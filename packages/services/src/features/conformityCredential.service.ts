import _ from 'lodash';
import { getJsonDataFromConformityAPI } from '../api.service.js';
import { IContext, IUploadCredentialConfig, RequestConfig } from '../types/IConformityCredential.js';
import LocalStorageService, { uploadJson } from '../storage.service.js';
import { generateUUID, hasNonEmptyObjectProperty } from '../utils/helpers.js';
import { checkContextConformityServiceProperties } from './validateContext.js';

const handleCredential = async (
  config: RequestConfig,
  uploadCredentialConfig: IUploadCredentialConfig,
  conformityCredentials: string[],
) => {
  // Get the JSON data from the API
  const getJsonData = await getJsonDataFromConformityAPI(config);

  // Save the credentials to the local storage if the data is a url string
  if (_.isString(getJsonData)) {
    conformityCredentials.push(getJsonData);
    LocalStorageService.set('conformityCredentials', JSON.stringify(conformityCredentials));
    alert('Conformity credentials have been saved');
    return;
  }

  // Check if the data is an object
  if (hasNonEmptyObjectProperty(getJsonData, 'credentials')) {
    // Upload the credentials to the server
    const vcUrl = await uploadJson({
      filename: generateUUID(),
      json: getJsonData,
      bucket: uploadCredentialConfig?.options?.bucket as string,
      storageAPIUrl: uploadCredentialConfig.url,
    });
    conformityCredentials.push(vcUrl);
    LocalStorageService.set('conformityCredentials', JSON.stringify(conformityCredentials));
    alert('Conformity credentials have been saved');
    return;
  }

  // Handle the error
  alert('Something went wrong while saving the credentials');
  return;
};
/**
 * Conformity credential service to get the credentials and save them to the local storage
 * @param context
 */
export const conformityCredentialService = async (context: IContext) => {
  try {
    // Check if the context conforms to the required properties
    const { ok, value } = checkContextConformityServiceProperties(context);
    if (!ok) throw new Error(value);

    // Get the conformity credentials from the local storage
    const conformityCredentials = JSON.parse(LocalStorageService.get('conformityCredentials') ?? '[]');

    if (!_.isArray(conformityCredentials)) {
      throw new Error('conformityCredentials is not an array');
    }

    const { uploadCredentialConfig } = context;

    // Handle the credentials
    await Promise.all(
      context?.credentialRequestConfig?.map((config: RequestConfig) =>
        handleCredential(config, uploadCredentialConfig, conformityCredentials),
      ),
    );
  } catch (error) {
    const e = error as Error;
    throw new Error(e.message);
  }
};
