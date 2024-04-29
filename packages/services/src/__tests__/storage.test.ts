import { storageService, uploadJson } from '../storage.service';
import { publicAPI } from '../utils/httpService';

jest.mock('../utils/httpService', () => ({
  publicAPI: {
    post: jest.fn(),
    put: jest.fn(),
    setContentTypeHeader: jest.fn(),
  },
}));

describe('upload json service', () => {
  beforeEach(() => {
    jest.resetModules();
    // Mock the File object
    (global as any).File = jest.fn((content, filename, options: any) => {
      return {
        content: content[0],
        name: filename,
        type: options.type,
      };
    });
  });

  it('should throw error when storageAPIUrl params is not defined', async () => {
    try {
      await uploadJson({ filename: 'test', bucket: 'test', json: {}, storageAPIUrl: '' });
    } catch (error) {
      expect(error).toEqual(new Error('storageAPIUrl is not defined'));
    }
  });

  it('should throw error when bucket name is invalid', async () => {
    try {
      await uploadJson({ filename: 'test', bucket: '', json: {}, storageAPIUrl: 'https://storage.com' });
    } catch (error) {
      expect(error).toEqual(new Error('bucket is not defined'));
    }
  });

  it('should return url when uploading json with valid VC', async () => {
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

    jest.spyOn(publicAPI, 'post').mockResolvedValue({
      presignedUrl: 'https://dev-verifiable-credentials.com/NH020188LEJ00005/dlp-did-web.json',
    });
    jest.spyOn(publicAPI, 'setContentTypeHeader').mockReturnValue();
    jest.spyOn(publicAPI, 'put').mockResolvedValue('');

    const url = await uploadJson({
      filename: 'test',
      bucket: 'dev-bucket',
      json: { ...credentialPayload },
      storageAPIUrl: 'https://storage.com',
    });
    expect(url).toEqual('https://dev-bucket.s3.ap-southeast-2.amazonaws.com/test');
  });

  it('should throw error when uploading json when put file to S3 failed', async () => {
    try {
      jest.spyOn(publicAPI, 'post').mockResolvedValue({
        presignedUrl: 'https://dev-verifiable-credentials.com/NH020188LEJ00005/dlp-did-web.json',
      });

      jest.spyOn(publicAPI, 'put').mockRejectedValueOnce(new Error('Error uploading json'));
      await uploadJson({ filename: 'test', bucket: 'test', json: {}, storageAPIUrl: 'https://storage.com' });
    } catch (error) {
      expect(error).toEqual(new Error('Error uploading json'));
    }
  });
});

describe('upload json config service', () => {
  afterEach(() => {
    jest.resetAllMocks();
  })

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

  it('should return url when uploading json with valid VC and method is POST', async () => {
    const path = 'bachelorDegree/vc.json';
    jest.spyOn(publicAPI, 'post').mockResolvedValue(`https://dev-verifiable-credentials.com/${path}`);

    const url = await storageService({
      url: 'https://storage.com',
      params: {  
        "data": credentialPayload,
        "path": path 
      },
    });
    expect(url).toEqual(`https://dev-verifiable-credentials.com/${path}`);
  });

  it('should return url when uploading json with valid VC and method is PUT', async () => {
    const path = 'bachelorDegree/vc.json';
    jest.spyOn(publicAPI, 'put').mockResolvedValue(`https://dev-verifiable-credentials.com/${path}`);

    const url = await storageService({
      url: 'https://storage.com',
      params: {  
        "data": credentialPayload,
        "path": path 
      },
      options: {
        method: 'PUT',
        headers: []
      }
    });
    expect(url).toEqual(`https://dev-verifiable-credentials.com/${path}`);
  });

  // error cases
  it('should throw error when uploading json with invalid VC and method is POST', async () => {
    try {
      jest.spyOn(publicAPI, 'post').mockRejectedValue(new Error('Error uploading json'));
      await storageService({
        url: 'https://storage.com',
        params: {  
          "data": {},
          "path": 'bachelorDegree/vc.json' 
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
          "data": {},
          "path": 'bachelorDegree/vc.json' 
        },
        options: {
          method: 'PUT',
          headers: []
        }
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
          headers: []
        }
      });
    } catch (error) {
      expect(error).toEqual(new Error('Unsupported method'));
    }
  });
})