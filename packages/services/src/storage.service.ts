import { IGetStorageServiceLink, IStorageService } from './types/storage.js';
import { getStorageUrlByPath } from './utils/helpers.js';
import { publicAPI } from './utils/httpService.js';

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

    const getResultByPath = getStorageUrlByPath(result, params.resultPath);
    return getResultByPath;
  } catch (error: any) {
    console.error(error);
    throw new Error(error.message);
  }
};

export const getStorageServiceLink: IGetStorageServiceLink = async (storage, data, filename) => {
  return await storageService({
    url: storage.url,
    params: {
      ...storage.params,
      data,
      filename,
    },
    options: storage.options,
  });
};
