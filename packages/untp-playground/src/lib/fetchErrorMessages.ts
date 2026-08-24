/**
 * User-facing copy for /api/fetch error codes, shared by every caller of the proxy so the same
 * failure reads the same everywhere (generic uploader and link set resolver).
 */

const MAX_FETCH_MB = 10;

export function fetchErrorMessage(code: string, fallback: string): string {
  switch (code) {
    case 'invalid-url':
      return 'That is not a valid URL.';
    case 'blocked':
      return 'That URL is blocked. Only https URLs to public hosts are allowed.';
    case 'not-found':
      return 'The URL returned 404. Check the address.';
    case 'timeout':
      return 'The URL did not respond in time.';
    case 'too-large':
      return `That response is larger than ${MAX_FETCH_MB} MB.`;
    case 'too-many-redirects':
      return 'The URL redirected too many times.';
    case 'network': {
      // The proxy folds upstream HTTP failures into 'network'; a 403/500 means the URL WAS
      // reached and answered with an error, which is a different problem from unreachability.
      const status = /Upstream returned (\d{3})/.exec(fallback)?.[1];
      if (status) {
        return `The URL returned ${status}. Check the address and whether the document is publicly accessible.`;
      }
      return 'Could not reach the URL. Check the address and try again.';
    }
    default:
      return fallback;
  }
}
