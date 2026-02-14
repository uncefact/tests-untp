import { verifyDidWebVh } from './verify-did-webvh';
import { DidMethodNotSupportedError } from '../errors';

describe('verifyDidWebVh', () => {
  it('throws DidMethodNotSupportedError for unimplemented verification', async () => {
    await expect(verifyDidWebVh('did:webvh:example.com:abc123')).rejects.toThrow(DidMethodNotSupportedError);
  });
});
