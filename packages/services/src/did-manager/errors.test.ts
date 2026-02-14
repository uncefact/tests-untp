import { ServiceError } from '../errors.js';
import {
  DidError,
  DidConfigError,
  DidMethodNotSupportedError,
  DidInputError,
  DidCreateError,
  DidDocumentFetchError,
  DidParseError,
} from './errors.js';

describe('DID errors', () => {
  describe('DidError', () => {
    it('extends ServiceError', () => {
      const err = new DidError('test', 'DID_TEST', 500);
      expect(err).toBeInstanceOf(ServiceError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('DidError');
    });
  });

  describe('DidConfigError', () => {
    it('constructs message from field name', () => {
      const err = new DidConfigError('apiUrl');
      expect(err.message).toBe('DID adapter configuration error: apiUrl is required.');
      expect(err.code).toBe('DID_CONFIG_INVALID');
      expect(err.statusCode).toBe(500);
      expect(err.context).toEqual({ field: 'apiUrl' });
      expect(err.name).toBe('DidConfigError');
      expect(err).toBeInstanceOf(DidError);
      expect(err).toBeInstanceOf(ServiceError);
    });
  });

  describe('DidMethodNotSupportedError', () => {
    it('constructs message from method', () => {
      const err = new DidMethodNotSupportedError('did:webvh');
      expect(err.message).toBe('DID method "did:webvh" is not supported.');
      expect(err.code).toBe('DID_METHOD_NOT_SUPPORTED');
      expect(err.statusCode).toBe(400);
      expect(err.context).toEqual({ method: 'did:webvh', operation: undefined });
      expect(err.name).toBe('DidMethodNotSupportedError');
      expect(err).toBeInstanceOf(DidError);
      expect(err).toBeInstanceOf(ServiceError);
    });

    it('includes operation when provided', () => {
      const err = new DidMethodNotSupportedError('did:webvh', 'creation');
      expect(err.message).toBe('DID method "did:webvh" is not supported for creation.');
      expect(err.context).toEqual({ method: 'did:webvh', operation: 'creation' });
    });
  });

  describe('DidInputError', () => {
    it('constructs message from detail', () => {
      const err = new DidInputError('DID string is required');
      expect(err.message).toBe('Invalid DID input: DID string is required');
      expect(err.code).toBe('DID_INPUT_INVALID');
      expect(err.statusCode).toBe(400);
      expect(err.context).toEqual({ detail: 'DID string is required' });
      expect(err.name).toBe('DidInputError');
      expect(err).toBeInstanceOf(DidError);
      expect(err).toBeInstanceOf(ServiceError);
    });
  });

  describe('DidCreateError', () => {
    it('constructs message from detail and httpStatus', () => {
      const err = new DidCreateError('upstream timeout', 504);
      expect(err.message).toBe('Failed to create DID: upstream timeout');
      expect(err.code).toBe('DID_CREATE_FAILED');
      expect(err.statusCode).toBe(502);
      expect(err.context).toEqual({ httpStatus: 504 });
      expect(err.name).toBe('DidCreateError');
      expect(err).toBeInstanceOf(DidError);
      expect(err).toBeInstanceOf(ServiceError);
    });

    it('handles missing httpStatus', () => {
      const err = new DidCreateError('network failure');
      expect(err.message).toBe('Failed to create DID: network failure');
      expect(err.context).toEqual({ httpStatus: undefined });
    });
  });

  describe('DidDocumentFetchError', () => {
    it('constructs message from did, detail, and httpStatus', () => {
      const err = new DidDocumentFetchError('did:web:example.com', 'not found', 404);
      expect(err.message).toBe('Failed to fetch DID document for "did:web:example.com": not found');
      expect(err.code).toBe('DID_DOCUMENT_FETCH_FAILED');
      expect(err.statusCode).toBe(502);
      expect(err.context).toEqual({ did: 'did:web:example.com', httpStatus: 404 });
      expect(err.name).toBe('DidDocumentFetchError');
      expect(err).toBeInstanceOf(DidError);
      expect(err).toBeInstanceOf(ServiceError);
    });

    it('handles missing httpStatus', () => {
      const err = new DidDocumentFetchError('did:web:example.com', 'network error');
      expect(err.message).toContain('did:web:example.com');
      expect(err.context).toEqual({ did: 'did:web:example.com', httpStatus: undefined });
    });
  });

  describe('DidParseError', () => {
    it('constructs message from did and detail', () => {
      const err = new DidParseError('not-a-did', 'missing "did:" prefix');
      expect(err.message).toBe('Failed to parse DID "not-a-did": missing "did:" prefix');
      expect(err.code).toBe('DID_PARSE_FAILED');
      expect(err.statusCode).toBe(400);
      expect(err.context).toEqual({ did: 'not-a-did' });
      expect(err.name).toBe('DidParseError');
      expect(err).toBeInstanceOf(DidError);
      expect(err).toBeInstanceOf(ServiceError);
    });
  });
});
