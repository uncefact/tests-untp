import { validateContextDPP } from '../validateContext';
import { contextDPP } from './mocks/constants';

describe('validateContext', () => {
  describe('successful case', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should return success when context is valid', () => {
      const result = validateContextDPP(contextDPP as any);
      expect(result.ok).toBe(true);
      expect(result.value).toEqual(contextDPP);
    });
  });

  describe('error case', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should return error when vckit context is empty', () => {
      const newContext = {
        ...contextDPP,
        vckit: {},
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
    });

    it('should return error when dpp context is empty', () => {
      const newContext = {
        ...contextDPP,
        dpp: {},
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
    });

    it('should return error when dlr context is empty', () => {
      const newContext = {
        ...contextDPP,
        dlr: {},
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
    });

    it('should return error when storage context is empty', () => {
      const newContext = {
        ...contextDPP,
        storage: {},
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
    });

    it('should return error when context is empty identifierKeyPath field', () => {
      const newContext = {
        ...contextDPP,
        identifierKeyPath: '',
      };

      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('identifierKeyPath not found');
    });

    it('should return error when vckitAPIUrl in vckit context is invalid', () => {
      const newContext = {
        ...contextDPP,
        vckit: {
          vckitAPIUrl: '',
        },
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid vckitAPIUrl');
    });

    it('should return error when issuer in vckit context is invalid', () => {
      const newContext = {
        ...contextDPP,
        vckit: {
          ...contextDPP.vckit,
          issuer: '',
        },
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid issuer');
    });

    it('should return error when context of dpp is invalid', () => {
      const newContext = {
        ...contextDPP,
        dpp: {
          ...contextDPP.dpp,
          context: [],
        },
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dpp context');
    });

    it('should return error when type dpp in context is invalid', () => {
      const newContext = {
        ...contextDPP,
        dpp: {
          ...contextDPP.dpp,
          type: [],
        },
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid type');
    });

    it('should return error when dlrLinkTitle in dpp context is invalid', () => {
      const newContext = {
        ...contextDPP,
        dpp: {
          ...contextDPP.dpp,
          dlrLinkTitle: '',
        },
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dlrLinkTitle');
    });

    it('should return error when dlrVerificationPage in dpp context is invalid', () => {
      const newContext = {
        ...contextDPP,
        dpp: {
          ...contextDPP.dpp,
          dlrVerificationPage: '',
        },
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dlrVerificationPage');
    });

    it('should return error when dlrIdentificationKeyType in dpp context is invalid', () => {
      const newContext = {
        ...contextDPP,
        dpp: {
          ...contextDPP.dpp,
          dlrIdentificationKeyType: '',
        },
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dlrIdentificationKeyType');
    });

    it('should return error when storageAPIUrl in storage context is invalid', () => {
      const newContext = {
        ...contextDPP,
        storage: {
          ...contextDPP.storage,
          url: '',
        },
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid storage url');
    });

    it('should return error when params in storage context is invalid', () => {
      const newContext = {
        ...contextDPP,
        storage: {
          ...contextDPP.storage,
          params: {},
        },
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid storage params');
    });

    it('should return error when dlrAPIUrl in dlr context is invalid', () => {
      const newContext = {
        ...contextDPP,
        dlr: {
          ...contextDPP.dlr,
          dlrAPIUrl: '',
        },
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dlrAPIUrl');
    });

    it('should return error when dlrAPIKey in dlr context is invalid', () => {
      const newContext = {
        ...contextDPP,
        dlr: {
          ...contextDPP.dlr,
          dlrAPIKey: '',
        },
      };
      const result = validateContextDPP(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dlrAPIKey');
    });
  });
});
