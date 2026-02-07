import { verifyDidWebVh } from './verify-did-webvh';

describe('verifyDidWebVh', () => {
  it('throws not-yet-implemented error', async () => {
    await expect(
      verifyDidWebVh('did:webvh:example.com:abc123'),
    ).rejects.toThrow('did:webvh verification is not yet implemented');
  });
});
