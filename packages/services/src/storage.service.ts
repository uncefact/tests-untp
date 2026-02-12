import { IStorageService, IUploadData } from './types/storage.js';
import { publicAPI } from './utils/httpService.js';
import { createLogger } from './logging/factory.js';

const logger = createLogger().child({ module: 'storage.service' });

export const storageService: IStorageService = async (config) => {
  const { url, params, options = { method: 'POST', headers: [] } } = config;
  try {
    let result;
    switch (options.method) {
      case 'PUT':
        result = await publicAPI.put<string>(url, params, options);
        break;
      case 'POST':
        result = await publicAPI.post<string>(url, params, options);
        break;
      default:
        throw new Error(`Unsupported method`);
    }

    return result;
  } catch (error: any) {
    logger.error({ error, url, method: options.method }, 'Storage service request failed');
    throw new Error(error.message);
  }
};

export const uploadData: IUploadData = async (storage, data, id) => {
  const result = await storageService({
    url: storage.url,
    params: {
      ...storage.params,
      data,
      id,
    },
    options: storage.options,
  });

  return result;
};
