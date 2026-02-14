import { ServiceError } from '../errors.js';

/** Base error for all Identity Resolver service operations. */
export class IdrError extends ServiceError {}

/**
 * A link ID references a link that no longer exists on the upstream resolver.
 * Typically HTTP 404 or 410 — indicates desynchronisation between local records and the IDR.
 */
export class IdrLinkNotFoundError extends IdrError {
  constructor(linkId: string, httpStatus?: number) {
    super(
      `IDR link "${linkId}" not found on upstream resolver (HTTP ${httpStatus ?? 'unknown'}).`,
      'IDR_LINK_NOT_FOUND',
      404,
      { linkId, httpStatus },
    );
  }
}

/** Failed to publish links to the upstream IDR. */
export class IdrPublishError extends IdrError {
  constructor(identifierScheme: string, identifier: string, httpStatus: number, detail: string) {
    super(
      `Failed to publish links for ${identifierScheme}/${identifier}: HTTP ${httpStatus}: ${detail}`,
      'IDR_PUBLISH_FAILED',
      502,
      { identifierScheme, identifier, httpStatus },
    );
  }
}

/** Failed to fetch a link by ID from the upstream IDR. */
export class IdrLinkFetchError extends IdrError {
  constructor(linkId: string, httpStatus: number, detail: string) {
    super(
      `Failed to fetch link "${linkId}" from upstream IDR: HTTP ${httpStatus}: ${detail}`,
      'IDR_LINK_FETCH_FAILED',
      502,
      { linkId, httpStatus },
    );
  }
}

/** Failed to update a link on the upstream IDR. */
export class IdrLinkUpdateError extends IdrError {
  constructor(linkId: string, httpStatus: number, detail: string) {
    super(
      `Failed to update link "${linkId}" on upstream IDR: HTTP ${httpStatus}: ${detail}`,
      'IDR_LINK_UPDATE_FAILED',
      502,
      { linkId, httpStatus },
    );
  }
}

/** Failed to delete a link from the upstream IDR. */
export class IdrLinkDeleteError extends IdrError {
  constructor(linkId: string, httpStatus: number, detail: string) {
    super(
      `Failed to delete link "${linkId}" from upstream IDR: HTTP ${httpStatus}: ${detail}`,
      'IDR_LINK_DELETE_FAILED',
      502,
      { linkId, httpStatus },
    );
  }
}

/** Failed to fetch the resolver description from the upstream IDR. */
export class IdrResolverFetchError extends IdrError {
  constructor(httpStatus: number, detail: string) {
    super(
      `Failed to fetch resolver description from upstream IDR: HTTP ${httpStatus}: ${detail}`,
      'IDR_RESOLVER_FETCH_FAILED',
      502,
      { httpStatus },
    );
  }
}

/** Failed to fetch link types from the upstream IDR. */
export class IdrLinkTypesFetchError extends IdrError {
  constructor(httpStatus: number, detail: string) {
    super(
      `Failed to fetch link types from upstream IDR: HTTP ${httpStatus}: ${detail}`,
      'IDR_LINK_TYPES_FETCH_FAILED',
      502,
      { httpStatus },
    );
  }
}
