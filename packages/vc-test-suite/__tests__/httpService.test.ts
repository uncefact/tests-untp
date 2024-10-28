import { request } from '../httpService';
import axios from 'axios';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('httpService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    const mockRequest = jest.fn().mockResolvedValue({ data: 'mocked response' });

    mockedAxios.create.mockReturnValue({
      request: mockRequest,
    } as any);
  });

  it('should accept a plain object for headers', async () => {
    const params = { headers: { test: 'test' } };
    const result = await request(params);

    expect(result).toEqual({ data: 'mocked response' });

    const mockAxiosInstance = mockedAxios.create.mock.results[0].value;
    expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    expect(mockAxiosInstance.request).toHaveBeenCalledWith(params);
  });

  it('should throw an error if headers is not a plain object', async () => {
    await expect(request({ headers: [] as any })).rejects.toThrow(
      'Headers specified in the config must be a plain object with string values.',
    );
  });

  it('should throw an error if headers contain non-string values', async () => {
    await expect(request({ headers: { test: 123 } as any })).rejects.toThrow(
      'Headers specified in the config must be a plain object with string values.',
    );
  });

  it('should work when no headers are provided in params', async () => {
    const params = { url: 'test-url' };
    const result = await request(params);

    expect(result).toEqual({ data: 'mocked response' });

    const mockAxiosInstance = mockedAxios.create.mock.results[0].value;
    expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    expect(mockAxiosInstance.request).toHaveBeenCalledWith(params);
  });
});
