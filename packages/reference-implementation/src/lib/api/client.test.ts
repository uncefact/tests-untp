import { ApiError, throwApiError, handleResponse } from './client';

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeResponse(overrides: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
}): Response {
  return {
    ok: overrides.ok ?? true,
    status: overrides.status ?? 200,
    statusText: overrides.statusText ?? 'OK',
    json: overrides.json ?? jest.fn().mockResolvedValue({}),
  } as unknown as Response;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ApiError', () => {
  it('should extend Error with name, status, and optional code', () => {
    const err = new ApiError('Bad request', 400, 'VALIDATION');

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
    expect(err.message).toBe('Bad request');
    expect(err.status).toBe(400);
    expect(err.code).toBe('VALIDATION');
  });

  it('should allow code to be omitted', () => {
    const err = new ApiError('Not found', 404);

    expect(err.code).toBeUndefined();
  });
});

describe('throwApiError', () => {
  it('should throw an ApiError with message and code from the response body', async () => {
    const response = fakeResponse({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: jest.fn().mockResolvedValue({ error: 'Invalid input', code: 'INVALID' }),
    });

    try {
      await throwApiError(response);
      fail('Expected throwApiError to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ message: 'Invalid input', status: 422, code: 'INVALID' });
    }
  });

  it('should fall back to statusText when response body is not valid JSON', async () => {
    const response = fakeResponse({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: jest.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
    });

    try {
      await throwApiError(response);
      fail('Expected throwApiError to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ message: 'Internal Server Error', status: 500, code: undefined });
    }
  });

  it('should fall back to statusText when body has no error field', async () => {
    const response = fakeResponse({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      json: jest.fn().mockResolvedValue({ detail: 'No access' }),
    });

    try {
      await throwApiError(response);
      fail('Expected throwApiError to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ message: 'Forbidden', status: 403 });
    }
  });
});

describe('handleResponse', () => {
  it('should return parsed JSON for successful responses', async () => {
    const data = { id: '123', name: 'Test' };
    const response = fakeResponse({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(data),
    });

    const result = await handleResponse<typeof data>(response);

    expect(result).toEqual(data);
  });

  it('should throw ApiError for non-ok responses', async () => {
    const response = fakeResponse({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: jest.fn().mockResolvedValue({ error: 'Resource not found' }),
    });

    try {
      await handleResponse(response);
      fail('Expected handleResponse to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ message: 'Resource not found', status: 404 });
    }
  });
});
