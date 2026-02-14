import { ServiceError } from '../errors.js';
import {
  IdrError,
  IdrLinkNotFoundError,
  IdrPublishError,
  IdrLinkFetchError,
  IdrLinkUpdateError,
  IdrLinkDeleteError,
  IdrResolverFetchError,
  IdrLinkTypesFetchError,
} from './errors.js';

describe('IDR errors', () => {
  describe('IdrError', () => {
    it('extends ServiceError', () => {
      const err = new IdrError('test', 'IDR_TEST', 500);
      expect(err).toBeInstanceOf(ServiceError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe('IdrError');
    });
  });

  describe('IdrLinkNotFoundError', () => {
    it('constructs message from linkId and httpStatus', () => {
      const err = new IdrLinkNotFoundError('link-42', 404);
      expect(err.message).toContain('link-42');
      expect(err.message).toContain('404');
      expect(err.code).toBe('IDR_LINK_NOT_FOUND');
      expect(err.statusCode).toBe(404);
      expect(err.context).toEqual({ linkId: 'link-42', httpStatus: 404 });
      expect(err).toBeInstanceOf(IdrError);
    });

    it('handles missing httpStatus', () => {
      const err = new IdrLinkNotFoundError('link-42');
      expect(err.message).toContain('unknown');
      expect(err.statusCode).toBe(404);
    });
  });

  describe('IdrPublishError', () => {
    it('constructs message from scheme, identifier, status, detail', () => {
      const err = new IdrPublishError('abn', '51824753556', 500, 'server error');
      expect(err.message).toContain('abn');
      expect(err.message).toContain('51824753556');
      expect(err.message).toContain('500');
      expect(err.message).toContain('server error');
      expect(err.code).toBe('IDR_PUBLISH_FAILED');
      expect(err.statusCode).toBe(502);
      expect(err).toBeInstanceOf(IdrError);
    });
  });

  describe('IdrLinkFetchError', () => {
    it('constructs message from linkId, status, detail', () => {
      const err = new IdrLinkFetchError('link-1', 500, 'timeout');
      expect(err.message).toContain('link-1');
      expect(err.code).toBe('IDR_LINK_FETCH_FAILED');
      expect(err.statusCode).toBe(502);
    });
  });

  describe('IdrLinkUpdateError', () => {
    it('constructs message from linkId, status, detail', () => {
      const err = new IdrLinkUpdateError('link-1', 422, 'invalid');
      expect(err.message).toContain('link-1');
      expect(err.code).toBe('IDR_LINK_UPDATE_FAILED');
      expect(err.statusCode).toBe(502);
    });
  });

  describe('IdrLinkDeleteError', () => {
    it('constructs message from linkId, status, detail', () => {
      const err = new IdrLinkDeleteError('link-1', 500, 'locked');
      expect(err.message).toContain('link-1');
      expect(err.code).toBe('IDR_LINK_DELETE_FAILED');
      expect(err.statusCode).toBe(502);
    });
  });

  describe('IdrResolverFetchError', () => {
    it('constructs message from status and detail', () => {
      const err = new IdrResolverFetchError(503, 'unavailable');
      expect(err.message).toContain('503');
      expect(err.code).toBe('IDR_RESOLVER_FETCH_FAILED');
      expect(err.statusCode).toBe(502);
    });
  });

  describe('IdrLinkTypesFetchError', () => {
    it('constructs message from status and detail', () => {
      const err = new IdrLinkTypesFetchError(500, 'crash');
      expect(err.message).toContain('500');
      expect(err.code).toBe('IDR_LINK_TYPES_FETCH_FAILED');
      expect(err.statusCode).toBe(502);
    });
  });
});
