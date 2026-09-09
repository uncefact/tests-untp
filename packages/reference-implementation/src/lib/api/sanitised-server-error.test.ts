jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockGetRequestContext = jest.fn();
jest.mock('@uncefact/untp-ri-services/logging', () => ({
  getRequestContext: () => mockGetRequestContext(),
}));

import { sanitisedServerError } from './sanitised-server-error';

describe('sanitisedServerError', () => {
  it('logs safe error details and returns a correlation-id 500 for the caller detail', async () => {
    mockGetRequestContext.mockReturnValue({ correlationId: 'correlation-963' });
    const logger = { error: jest.fn() };
    const error = new Error('internal detail');

    const response = sanitisedServerError(error, logger, 'The caller-facing detail');

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('correlation id "correlation-963"'),
    });
    expect(logger.error).toHaveBeenCalledWith(
      { error: { name: 'Error', message: 'internal detail' } },
      'The caller-facing detail',
    );
  });
});
