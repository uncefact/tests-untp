import { IFetchFunction, RequestConfig } from './types/IConformityCredential.js';
import { publicAPI } from './utils/httpService.js';
import { createLogger } from './logging/factory.js';

const logger = createLogger().child({ module: 'api.service' });

/**
 * Get the JSON data from the API
 * @param url The URL to get the JSON data from
 * @returns The JSON data
 */
export const getJsonDataFromConformityAPI: IFetchFunction = async (config: RequestConfig) => {
  const { url, params, options = { method: 'POST', headers: [] } } = config;

  try {
    let result;
    switch (options.method) {
      case 'GET':
        result = await publicAPI.get(url, { headers: options?.headers });
        break;
      case 'POST':
        result = await publicAPI.post(url, params, options);
        break;
      default:
        throw new Error(`Unsupported method`);
    }
    return result;
  } catch (error: any) {
    logger.error({ error, url, method: options.method }, 'Conformity API request failed');
    throw new Error(error.message);
  }
};
