describe('verifyCredential', () => {
  const originalBasePath = process.env.NEXT_PUBLIC_BASE_PATH;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.resetModules();
  });

  afterEach(() => {
    if (originalBasePath === undefined) {
      delete process.env.NEXT_PUBLIC_BASE_PATH;
    } else {
      process.env.NEXT_PUBLIC_BASE_PATH = originalBasePath;
    }
  });

  it('sends credential to local API route when no base path is set', async () => {
    delete process.env.NEXT_PUBLIC_BASE_PATH;
    const mockResponse = { verified: true };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    const { verifyCredential } = await import('@/lib/verificationService');
    const result = await verifyCredential({ type: 'VerifiableCredential' });

    expect(global.fetch).toHaveBeenCalledWith('/api/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: { type: 'VerifiableCredential' } }),
    });
    expect(result).toEqual(mockResponse);
  });

  it('prefixes the request with NEXT_PUBLIC_BASE_PATH when set', async () => {
    process.env.NEXT_PUBLIC_BASE_PATH = '/test-untp-playground';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ verified: true }),
    });

    const { verifyCredential } = await import('@/lib/verificationService');
    await verifyCredential({ type: 'VerifiableCredential' });

    expect(global.fetch).toHaveBeenCalledWith(
      '/test-untp-playground/api/verify',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws on non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    const { verifyCredential } = await import('@/lib/verificationService');
    await expect(verifyCredential({})).rejects.toThrow('Verification failed');
  });

  it('throws on network error', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

    const { verifyCredential } = await import('@/lib/verificationService');
    await expect(verifyCredential({})).rejects.toThrow('Network error');
  });
});
