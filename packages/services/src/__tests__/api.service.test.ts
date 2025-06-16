import { getJsonDataFromConformityAPI } from '../api.service';
import { FetchOptions } from '../types/IConformityCredential';
import { publicAPI } from '../utils/httpService';

describe('Conformity Credential Request', () => {
  const url = 'https://example.com/api';
  const params = { test: 'test' };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return the JSON data from the API with default options', async () => {
    jest.spyOn(publicAPI, 'post').mockResolvedValueOnce(params);
    const result = await getJsonDataFromConformityAPI({ url, params });
    expect(result).toEqual(params);
  });

  it('should return the JSON data from the API with method is get', async () => {
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(params);
    const options = { method: 'GET' } as FetchOptions;

    const result = await getJsonDataFromConformityAPI({ url, params, options });
    expect(result).toEqual(params);
  });

  it('should return the JSON data from the API with method is post', async () => {
    jest.spyOn(publicAPI, 'post').mockResolvedValueOnce(params);
    const options = { method: 'POST' } as FetchOptions;
    const result = await getJsonDataFromConformityAPI({ url, params, options });
    expect(result).toEqual(params);
  });

  it('should throw an error if the API call fails', async () => {
    const options = { method: 'PUT', headers: [] } as any;
    await expect(getJsonDataFromConformityAPI({ url, params, options })).rejects.toThrow('Unsupported method');
  });

  it('should throw an error if the API call fails', async () => {
    jest.spyOn(publicAPI, 'post').mockRejectedValueOnce(new Error('API call failed'));
    await expect(getJsonDataFromConformityAPI({ url, params })).rejects.toThrow('API call failed');
  });
});
