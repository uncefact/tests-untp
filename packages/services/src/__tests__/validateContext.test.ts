import { validateContextObjectEvent } from '../epcisEvents/validateContext';
import { contextObjectEvent } from './mocks/constants';

describe('validateContext', () => {
  describe('successful case', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should return success when context is valid', () => {
      const result = validateContextObjectEvent(contextObjectEvent as any);
      expect(result.ok).toBe(true);
      expect(result.value).toEqual(contextObjectEvent);
    });
  });

  describe('error case', () => {
    afterEach(() => {
      jest.clearAllMocks();
    });

    it('should return error when vckit context is empty', () => {
      const newContext = {
        ...contextObjectEvent,
        vckit: {},
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
    });

    it('should return error when dpp context is empty', () => {
      const newContext = {
        ...contextObjectEvent,
        dpp: {},
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
    });

    it('should return error when dlr context is empty', () => {
      const newContext = {
        ...contextObjectEvent,
        dlr: {},
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
    });

    it('should return error when storage context is empty', () => {
      const newContext = {
        ...contextObjectEvent,
        storage: {},
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
    });

    it('should return error when context is empty identifierKeyPaths field', () => {
      const newContext = {
        ...contextObjectEvent,
        identifierKeyPaths: [],
      };

      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('identifierKeyPaths not found');
    });

    it('should return error when vckitAPIUrl in vckit context is invalid', () => {
      const newContext = {
        ...contextObjectEvent,
        vckit: {
          vckitAPIUrl: '',
        },
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid vckitAPIUrl');
    });

    it('should return error when issuer in vckit context is invalid', () => {
      const newContext = {
        ...contextObjectEvent,
        vckit: {
          ...contextObjectEvent.vckit,
          issuer: '',
        },
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid issuer');
    });

    it('should return error when context of dpp is invalid', () => {
      const newContext = {
        ...contextObjectEvent,
        dpp: {
          ...contextObjectEvent.dpp,
          context: [],
        },
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dpp context');
    });

    it('should return error when type dpp in context is invalid', () => {
      const newContext = {
        ...contextObjectEvent,
        dpp: {
          ...contextObjectEvent.dpp,
          type: [],
        },
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid type');
    });

    it('should return error when dlrLinkTitle in dpp context is invalid', () => {
      const newContext = {
        ...contextObjectEvent,
        dpp: {
          ...contextObjectEvent.dpp,
          dlrLinkTitle: '',
        },
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dlrLinkTitle');
    });

    it('should return error when dlrVerificationPage in dpp context is invalid', () => {
      const newContext = {
        ...contextObjectEvent,
        dpp: {
          ...contextObjectEvent.dpp,
          dlrVerificationPage: '',
        },
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dlrVerificationPage');
    });

    it('should return error when dlrIdentificationKeyType in dpp context is invalid', () => {
      const newContext = {
        ...contextObjectEvent,
        dpp: {
          ...contextObjectEvent.dpp,
          dlrIdentificationKeyType: '',
        },
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dlrIdentificationKeyType');
    });

    it('should return error when storageAPIUrl in storage context is invalid', () => {
      const newContext = {
        ...contextObjectEvent,
        storage: {
          ...contextObjectEvent.storage,
          storageAPIUrl: '',
        },
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid storageAPIUrl');
    });

    it('should return error when bucket in storage context is invalid', () => {
      const newContext = {
        ...contextObjectEvent,
        storage: {
          ...contextObjectEvent.storage,
          bucket: '',
        },
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid bucket');
    });

    it('should return error when dlrAPIUrl in dlr context is invalid', () => {
      const newContext = {
        ...contextObjectEvent,
        dlr: {
          ...contextObjectEvent.dlr,
          dlrAPIUrl: '',
        },
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dlrAPIUrl');
    });

    it('should return error when dlrAPIKey in dlr context is invalid', () => {
      const newContext = {
        ...contextObjectEvent,
        dlr: {
          ...contextObjectEvent.dlr,
          dlrAPIKey: '',
        },
      };
      const result = validateContextObjectEvent(newContext as any);
      expect(result.ok).toBe(false);
      expect(result.value).toEqual('Invalid dlrAPIKey');
    });
  });
});
