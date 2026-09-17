import { ValidationError } from './validation';
import { strictIntQueryParam } from './request-schemas/shared';

const INVALID_IF_VERSION_MESSAGE = 'If-Version must be an integer between 1 and 2147483647.';
const MISSING_IF_VERSION_MESSAGE = 'If-Version header is required.';

/** Parses the required optimistic version header used by mutable records. */
export function parseIfVersion(raw: string | null): number {
  if (raw === null) {
    throw new ValidationError(MISSING_IF_VERSION_MESSAGE, { code: 'INVALID_IF_VERSION' });
  }
  // The shared parser carries its own `.optional()`, which only short-circuits
  // on an `undefined` input. The missing-header case is already answered above,
  // so the header value reaching here is always a string and `parsed.data` is
  // never `undefined` at run time. It is still checked, both to narrow the
  // return type to `number` and so a future change to the shared parser cannot
  // turn a missing version into a silent success.
  const parsed = strictIntQueryParam(
    INVALID_IF_VERSION_MESSAGE,
    (value) => value >= 1 && value <= 2147483647,
  ).safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    throw new ValidationError(INVALID_IF_VERSION_MESSAGE, { code: 'INVALID_IF_VERSION' });
  }
  return parsed.data;
}
