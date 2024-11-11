import { storageService, uploadData } from '../storage.service';
import { publicAPI } from '../utils/httpService';

jest.mock('../utils/httpService', () => ({
  publicAPI: {
    post: jest.fn(),
    put: jest.fn(),
    setContentTypeHeader: jest.fn(),
  },
}));

describe('storage service', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  const credentialPayload = {
    context: ['https://dev-render-method-context.s3.ap-southeast-1.amazonaws.com/dlp.json'], // fake url
    type: ['BachelorDegree'],
    issuer: 'did:web:localhost',
    credentialSubject: {
      id: 'did:web:localhost',
      name: 'John Doe',
      age: 30,
    },
  };

  it('should return url when uploading json with valid VC and method is POST as default', async () => {
    const path = 'bachelorDegree/vc.json';
    jest.spyOn(publicAPI, 'post').mockResolvedValue({
      url: `https://dev-verifiable-credentials.com/${path}`,
    });

    const url = await storageService({
      url: 'https://storage.com',
      params: {
        data: credentialPayload,
        path: path,
      },
    });
    expect(url).toEqual({
      url: `https://dev-verifiable-credentials.com/${path}`,
    });
  });

  it('should return url when uploading json with valid VC and method is PUT', async () => {
    const path = 'bachelorDegree/vc.json';
    jest.spyOn(publicAPI, 'put').mockResolvedValue({
      url: `https://dev-verifiable-credentials.com/${path}`,
    });

    const url = await storageService({
      url: 'https://storage.com',
      params: {
        data: credentialPayload,
        path: path,
        resultPath: '/url',
      },
      options: {
        method: 'PUT',
        headers: [],
      },
    });
    expect(url).toEqual({ url: `https://dev-verifiable-credentials.com/${path}` });
  });

  // error cases
  it('should throw error when uploading json with invalid VC and method is POST', async () => {
    try {
      jest.spyOn(publicAPI, 'post').mockRejectedValue(new Error('Error uploading json'));
      await storageService({
        url: 'https://storage.com',
        params: {
          data: {},
          path: 'bachelorDegree/vc.json',
        },
      });
    } catch (error) {
      expect(error).toEqual(new Error('Error uploading json'));
    }
  });

  it('should throw error when uploading json with invalid VC and method is PUT', async () => {
    try {
      jest.spyOn(publicAPI, 'put').mockRejectedValue(new Error('Error uploading json'));
      await storageService({
        url: 'https://storage.com',
        params: {
          data: {},
          path: 'bachelorDegree/vc.json',
        },
        options: {
          method: 'PUT',
          headers: [],
        },
      });
    } catch (error) {
      expect(error).toEqual(new Error('Error uploading json'));
    }
  });

  it('should throw error when uploading json with invalid method', async () => {
    try {
      await storageService({
        url: 'https://storage.com',
        params: {
        },
        options: {
          //@ts-ignore
          method: 'GET', // invalid method
          headers: [],
        },
      });
    } catch (error) {
      expect(error).toEqual(new Error('Unsupported method'));
    }
  });

  it('should throw error when uploading json with invalid params', async () => {
    try {
      await storageService({
        url: 'https://storage.com',
        //@ts-ignore
        params: {},
      });
    } catch (error) {
      expect(error).toEqual(new Error('Invalid result path'));
    }
  });
});
