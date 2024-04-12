import { checkContextConformityServiceProperties } from '../features/validateContext';

const contextObjectEvent = {
  credentialRequestConfig: [
    {
      url: 'https://example.com',
      params: {},
      options: {
        headers: [],
        method: 'POST',
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

describe('validateContext for Conformity Credential', () => {
  describe('successful case', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should return success when context is valid', () => {
      const result = checkContextConformityServiceProperties(contextObjectEvent as any);
      expect(result.ok).toBe(true);
      expect(result.value).toEqual(contextObjectEvent);
    });
  });

  describe('error case', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should return error when credentialRequestConfig in context is empty', () => {
      const newContext = {
        ...contextObjectEvent,
        credentialRequestConfig: {},
      };

      const result = checkContextConformityServiceProperties(newContext as any);
      expect(result.ok).toBe(false);
    });

    it('should return error when uploadCredentialConfig in context is empty', () => {
      const newContext = {
        ...contextObjectEvent,
        uploadCredentialConfig: {},
      };
      const result = checkContextConformityServiceProperties(newContext as any);
      expect(result.ok).toBe(false);
    });

    it('should return error when credentialRequestConfig url in context is empty', () => {
      const newContext = {
        ...contextObjectEvent,
        credentialRequestConfig: [
          {
            url: '',
          },
        ],
      };
      const result = checkContextConformityServiceProperties(newContext as any);
      expect(result.ok).toBe(false);
    });

    it('should return error when credentialRequestConfig url in context is exit one field invalidation', () => {
      const newContext = {
        ...contextObjectEvent,
        credentialRequestConfig: [
          {
            url: 'https://example.com',
          },
          {
            url: '',
          },
        ],
      };
      const result = checkContextConformityServiceProperties(newContext as any);
      expect(result.ok).toBe(true);
    });

    it('should return error when uploadCredentialConfig url in context is empty', () => {
      const newContext = {
        ...contextObjectEvent,
        uploadCredentialConfig: {
          url: '',
        },
      };
      const result = checkContextConformityServiceProperties(newContext as any);
      expect(result.ok).toBe(false);
    });
  });
});
