import { IFetchFunction, RequestConfig } from './types/IConformityCredential.js';
import { publicAPI } from './utils/httpService.js';

/**
 * Get the JSON data from the API
 * @param url The URL to get the JSON data from
 * @returns The JSON data
 */
export const getJsonDataFromConformityAPI: IFetchFunction = async (config: RequestConfig) => {
  const { url, params, options = { method: 'POST', headers: [] } } = config;

  console.log('getJsonDataFromConformityAPI', url, params, options);
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
    console.error(error);
    throw new Error(error.message);
  }
};
