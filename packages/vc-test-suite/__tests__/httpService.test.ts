import { request } from '../httpService';
import axios from 'axios';

jest.mock('axios');

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('httpService', () => {
  beforeEach(() => {
    mockedAxios.create.mockReturnValue({
      request: jest.fn().mockResolvedValue({ data: 'mocked response' }),
    } as any);
  });

  it('should accept a plain object for headers', async () => {
    const result = await request({ headers: { test: 'test' } });
    expect(result).toBeDefined();
    expect(result).toEqual({ data: 'mocked response' });
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
});
