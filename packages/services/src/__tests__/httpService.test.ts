import axios, { AxiosError, AxiosResponse } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { privateAPI, publicAPI } from '../utils/httpService';

jest.mock('axios', () => {
  return {
    ...jest.requireActual('axios'),
    create: jest.fn().mockReturnValue(jest.requireActual('axios')),
  };
});

const mockAdapter = new MockAdapter(axios);

describe('httpService', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should reuse class instance', () => {
    const instance1 = publicAPI;
    const instance2 = publicAPI;
    expect(instance1).toBe(instance2);

    const instance3 = privateAPI;
    const instance4 = privateAPI;
    expect(instance3).toBe(instance4);
  });

  it('should make a post request and return data', async () => {
    const responseData = { data: 'Test data' } as AxiosResponse;
    mockAdapter.onPost('http://localhost/test-url').reply(201, responseData);
    const result = await publicAPI.post('http://localhost/test-url');
    expect(result).toStrictEqual(responseData);
  });

  it('should make a post request and throw error', async () => {
    const errorResponse = { response: { status: 400 } } as AxiosError;
    mockAdapter.onPost('http://localhost/test-url').reply(400, errorResponse);

    try {
      await publicAPI.post('http://localhost/test-url');
    } catch (error) {
      expect(error).not.toBeNull();
    }
  });

  it('should make a get request and return data', async () => {
    const responseData = { data: 'Test data' } as AxiosResponse;
    mockAdapter.onGet('http://localhost/test-url').reply(201, responseData);
    const result = await publicAPI.get('http://localhost/test-url');
    expect(result).toStrictEqual(responseData);
  });

  it('should make a get request and throw error', async () => {
    const errorResponse = { response: { status: 400 } } as AxiosError;
    mockAdapter.onGet('http://localhost/test-url').reply(400, errorResponse);

    try {
      await publicAPI.get('http://localhost/test-url');
    } catch (error) {
      expect(error).not.toBeNull();
    }
  });

  it('should make a put request and return data', async () => {
    const responseData = { data: 'Test data' } as AxiosResponse;
    mockAdapter.onPut('http://localhost/test-url').reply(201, responseData);
    const result = await publicAPI.put('http://localhost/test-url');
    expect(result).toStrictEqual(responseData);
  });

  it('should make a put request and throw error', async () => {
    const errorResponse = { response: { status: 400 } } as AxiosError;
    mockAdapter.onPut('http://localhost/test-url').reply(400, errorResponse);

    try {
      await publicAPI.put('http://localhost/test-url');
    } catch (error) {
      expect(error).not.toBeNull();
    }
  });

  it('should set headers bearer token on privateAPI', async () => {
    const responseData = { data: 'Test data' } as AxiosResponse;
    mockAdapter.onGet('http://localhost/test-url').reply(201, responseData);

    privateAPI.setBearerTokenAuthorizationHeaders('test-token');
    await privateAPI.get('http://localhost/test-url');

    expect(axios.defaults.headers.common['Authorization']).toBe('Bearer test-token');
  });

  it('should set content type on privateAPI and publicAPI', async () => {
    const responseData = { data: 'Test data' } as AxiosResponse;
    mockAdapter.onGet('http://localhost/test-url').reply(201, responseData);

    privateAPI.setContentTypeHeader('application/file');
    await privateAPI.get('http://localhost/test-url');

    expect(axios.defaults.headers.common['Content-Type']).toBe('application/file');

    publicAPI.setContentTypeHeader('text/html');
    await publicAPI.get('http://localhost/test-url');
    expect(axios.defaults.headers.common['Content-Type']).toBe('text/html');
  });
});
