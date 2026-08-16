import { z } from 'zod';
import { nonBlankString, paginationQuerySchema } from './shared';

/** Query parameters for GET /cvc/schemes. */
export const listCvcSchemesQuerySchema = paginationQuerySchema;

/**
 * Query parameters for GET /cvc/profiles. The required `schemeId` filter is a
 * canonical scheme URI, not a database id, so it takes the non-blank string
 * contract rather than idSchema. Merged ahead of pagination so a filter issue
 * is reported before a pagination issue among the zod schema's own issues
 * (ADR-037). A repeated query key is rejected by parseQueryParams before
 * schema parsing runs at all, so that check takes precedence over both.
 */
export const listCvcProfilesQuerySchema = z
  .object({
    schemeId: nonBlankString,
  })
  .merge(paginationQuerySchema);

/** Query parameters for GET /cvc/criteria. `profileId` is a canonical profile URI. */
export const listCvcCriteriaQuerySchema = z
  .object({
    profileId: nonBlankString,
  })
  .merge(paginationQuerySchema);
