import { detectDevice } from '../utils/helpers';

describe('detectDevice', () => {
  it('detects mobile devices', () => {
    const mobileUserAgents = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Linux; Android 10; SM-A205U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Mobile Safari/537.36',
      // Add more mobile user agents as needed...
    ];

    mobileUserAgents.forEach((userAgent) => {
      expect(detectDevice(userAgent)).toBe('mobile');
    });
  });

  it('detects laptops', () => {
    const laptopUserAgents = [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.89 Safari/537.36',
      // Add more laptop user agents as needed...
    ];

    laptopUserAgents.forEach((userAgent) => {
      expect(detectDevice(userAgent)).toBe('laptop');
    });
  });

  it('returns unknown for other devices', () => {
    const unknownUserAgent = 'Mozilla/5.0 (X11; Linux x86_64; rv:15.0) Gecko/20100101 Firefox/15.0.1';

    expect(detectDevice(unknownUserAgent)).toBe('unknown');
  });
});
