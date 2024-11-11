import { IStorageService, IUploadData } from './types/storage.js';
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

    return result;
  } catch (error: any) {
    console.error(error);
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
