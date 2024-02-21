import { uploadJson } from '../../build/storage.service';
import { publicAPI } from '../../build/utils/httpService';

jest.mock('../../build/utils/httpService', () => ({
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
