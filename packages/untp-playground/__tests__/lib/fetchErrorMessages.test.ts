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

  it('surfaces the upstream HTTP status folded into the network code', () => {
    expect(fetchErrorMessage('network', 'Upstream returned 403 for https://x.example.org/a.json.')).toBe(
      'The URL returned 403. Check the address and whether the document is publicly accessible.',
    );
  });

  it('keeps the unreachable copy for a network failure without an upstream status', () => {
    expect(fetchErrorMessage('network', 'fetch failed')).toBe(
      'Could not reach the URL. Check the address and try again.',
    );
  });
});
