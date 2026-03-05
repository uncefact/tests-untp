describe('verifyCredential', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('sends credential to local API route', async () => {
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
