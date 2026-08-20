import { fetchErrorMessage } from '@/lib/fetchErrorMessages';

describe('fetchErrorMessage', () => {
  it.each([
    ['invalid-url', 'That is not a valid URL.'],
    ['blocked', 'That URL is blocked. Only https URLs to public hosts are allowed.'],
    ['not-found', 'The URL returned 404. Check the address.'],
    ['timeout', 'The URL did not respond in time.'],
    ['too-large', 'That response is larger than 10 MB.'],
    ['too-many-redirects', 'The URL redirected too many times.'],
    ['network', 'Could not reach the URL. Check the address and try again.'],
  ])('maps %s to its shared user-facing copy', (code, message) => {
    expect(fetchErrorMessage(code, 'fallback')).toBe(message);
  });

  it('returns the fallback for an unknown code', () => {
    expect(fetchErrorMessage('something-new', 'the fallback text')).toBe('the fallback text');
  });
});
