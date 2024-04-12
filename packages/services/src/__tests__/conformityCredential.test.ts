import { conformityCredentialService } from '../features/conformityCredential.service';
import { checkContextConformityServiceProperties } from '../features';
import LocalStorageService, { uploadJson } from '../storage.service';
import { getJsonDataFromConformityAPI } from '../api.service';
import { hasNonEmptyObjectProperty } from '../utils';

jest.mock('../features/validateContext', () => ({
  checkContextConformityServiceProperties: jest.fn(),
}));

jest.mock('../storage.service', () => ({
  LocalStorageService: jest.fn(() => ({
    get: jest.fn(() => null),
    set: jest.fn(),
  })),
  uploadJson: jest.fn(),
}));

jest.mock('../api.service', () => ({
  getJsonDataFromConformityAPI: jest.fn(),
}));

jest.mock('../utils/helpers', () => ({
  generateUUID: jest.fn().mockReturnValue('abiem48dj2'),
  hasNonEmptyObjectProperty: jest.fn(),
}));

describe('Conformity Credential Service', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });
  const context = {
    credentialRequestConfig: [
      {
        url: 'https://example1.com',
        params: {},
        options: {
          headers: [],
          method: 'POST',
        },
      },
      {
        url: 'https://example2.com',
        params: {},
        options: {
          headers: [],
          method: 'GET',
        },
      },
    ],
    uploadCredentialConfig: {
      url: 'https://example.com',
      params: {},
      options: {
        bucket: 'bucket-example',
      },
      type: 's3',
    },
  };

  describe('happy case', () => {
    const instance = LocalStorageService as any;

    beforeEach(() => {
      (checkContextConformityServiceProperties as jest.Mock).mockReturnValue({ ok: true, value: {} });
      (hasNonEmptyObjectProperty as jest.Mock).mockReturnValue(true);
    });

    it('should successfully store the URL in localStorage when the credential request returns a string', async () => {
      instance.get = jest.fn(() => {
        return [];
      });
      instance.set = jest.fn();

      JSON.parse = jest.fn().mockImplementation(() => {
        return [];
      });

      (getJsonDataFromConformityAPI as jest.Mock).mockResolvedValue('https://example.com');

      let message = 'Conformity credentials have been saved';
      global.alert = jest.fn().mockReturnValue(message);
      alert(message);

      await conformityCredentialService(context);
      expect(checkContextConformityServiceProperties).toHaveBeenCalledWith(context);
      expect(getJsonDataFromConformityAPI).toHaveBeenCalledWith(context.credentialRequestConfig[0]);
      expect(getJsonDataFromConformityAPI).toHaveBeenCalledWith(context.credentialRequestConfig[1]);
      expect(LocalStorageService.get).toHaveBeenCalled();
      expect(LocalStorageService.set).toHaveBeenCalled();
      expect(global.alert).toHaveBeenCalledWith(message);
    });

    it('should successfully store the URL in localStorage when the credential request returns an object', async () => {
      instance.get = jest.fn(() => {
        return ['https://example.com'];
      });
      instance.set = jest.fn();

      JSON.parse = jest.fn().mockImplementation(() => {
        return ['https://example.com'];
      });

      const jsonData = {
        credentials: {
          '@context': ['https://example.com'],
          type: 'VerifiableCredential',
          credentialSubject: {
            id: 'did:example:ebfeb1f712ebc6f1c276e12ec21',
          },
          proof: {
            type: 'Ed25519Signature2020',
          },
        },
      };

      (getJsonDataFromConformityAPI as jest.Mock).mockResolvedValue(jsonData);

      (uploadJson as jest.Mock).mockResolvedValue('https://example2.com');

      let message = 'Conformity credentials have been saved';
      global.alert = jest.fn().mockReturnValue(message);
      alert(message);

      await conformityCredentialService(context);
      expect(checkContextConformityServiceProperties).toHaveBeenCalledWith(context);
      expect(getJsonDataFromConformityAPI).toHaveBeenCalledWith(context.credentialRequestConfig[0]);
      expect(getJsonDataFromConformityAPI).toHaveBeenCalledWith(context.credentialRequestConfig[1]);
      expect(LocalStorageService.get).toHaveBeenCalled();
      expect(LocalStorageService.set).toHaveBeenCalled();
      expect(uploadJson).toHaveBeenCalledWith({
        filename: 'abiem48dj2',
        json: jsonData,
        bucket: context.uploadCredentialConfig.options.bucket,
        storageAPIUrl: context.uploadCredentialConfig.url,
      });
      expect(global.alert).toHaveBeenCalledWith(message);
    });
  });

  describe('error case', () => {
    const instance = LocalStorageService as any;

    it('should throw an error when the context does not conform to the required properties', async () => {
      (checkContextConformityServiceProperties as jest.Mock).mockReturnValue({ ok: false, value: 'Invalid context' });

      try {
        await conformityCredentialService({});
      } catch (error) {
        expect(error).toEqual(new Error('Invalid context'));
      }
    });

    it('should throw an error when localStorage is not available', async () => {
      (checkContextConformityServiceProperties as jest.Mock).mockReturnValue({ ok: true, value: {} });
      instance.get = jest.fn(() => {
        return 'example';
      });

      JSON.parse = jest.fn().mockImplementation(() => {
        return 'example';
      });

      try {
        await conformityCredentialService({});
      } catch (error) {
        expect(error).toEqual(new Error('conformityCredentials is not an array'));
      }
    });

    it('should throw an error when the credential request does not return a string or an object', async () => {
      (checkContextConformityServiceProperties as jest.Mock).mockReturnValue({ ok: true, value: {} });
      instance.get = jest.fn(() => {
        return [];
      });

      (hasNonEmptyObjectProperty as jest.Mock).mockReturnValue(false);

      JSON.parse = jest.fn().mockImplementation(() => {
        return [];
      });

      (getJsonDataFromConformityAPI as jest.Mock).mockResolvedValue(null);

      let message = 'Something went wrong while saving the credentials';
      global.alert = jest.fn().mockReturnValue(message);
      alert(message);

      try {
        await conformityCredentialService(context);
      } catch (error) {
        expect(error).toEqual(new Error('Something went wrong while saving the credentials'));
      }
    });
  });
});
