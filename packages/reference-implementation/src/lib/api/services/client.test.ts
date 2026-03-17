import { ApiError, throwIfNotOk, handleResponse, buildQueryString } from './client';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function errorResponse(status: number, body: { error: string; code?: string }, statusText = 'Error'): Response {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function nonJsonErrorResponse(status: number, statusText = 'Internal Server Error'): Response {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.reject(new SyntaxError('Unexpected token')),
  } as unknown as Response;
}

describe('ApiError', () => {
  it('has correct name, status, message, and code properties', () => {
    const error = new ApiError('Not found', 404, 'NOT_FOUND');

    expect(error.name).toBe('ApiError');
    expect(error.message).toBe('Not found');
    expect(error.status).toBe(404);
    expect(error.code).toBe('NOT_FOUND');
  });

  it('works without code (code is undefined)', () => {
    const error = new ApiError('Server error', 500);

    expect(error.code).toBeUndefined();
    expect(error.status).toBe(500);
    expect(error.message).toBe('Server error');
  });

  it('is an instance of Error', () => {
    const error = new ApiError('Bad request', 400);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ApiError);
  });
});

describe('throwIfNotOk', () => {
  it('does nothing for ok responses', async () => {
    const response = jsonResponse({ data: 'test' });

    await expect(throwIfNotOk(response)).resolves.toBeUndefined();
  });

  it('throws ApiError with message and code from JSON error body', async () => {
    const response = errorResponse(422, { error: 'Validation failed', code: 'VALIDATION_ERROR' });

    await expect(throwIfNotOk(response)).rejects.toThrow(ApiError);
    await expect(
      throwIfNotOk(errorResponse(422, { error: 'Validation failed', code: 'VALIDATION_ERROR' })),
    ).rejects.toMatchObject({
      message: 'Validation failed',
      status: 422,
      code: 'VALIDATION_ERROR',
    });
  });

  it('falls back to statusText when error body is not JSON', async () => {
    const response = nonJsonErrorResponse(500, 'Internal Server Error');

    await expect(throwIfNotOk(response)).rejects.toThrow(ApiError);
    await expect(throwIfNotOk(nonJsonErrorResponse(500, 'Internal Server Error'))).rejects.toMatchObject({
      message: 'Internal Server Error',
      status: 500,
      code: undefined,
    });
  });

  it('falls back to statusText when body has no error field', async () => {
    const response: Response = {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: () => Promise.resolve({ detail: 'something went wrong' }),
    } as unknown as Response;

    await expect(throwIfNotOk(response)).rejects.toMatchObject({
      message: 'Bad Request',
      status: 400,
      code: undefined,
    });
  });
});

describe('handleResponse', () => {
  it('returns parsed JSON for ok responses', async () => {
    const body = { id: 1, name: 'test' };
    const response = jsonResponse(body);

    const result = await handleResponse<typeof body>(response);

    expect(result).toEqual(body);
  });

  it('throws ApiError for non-ok responses', async () => {
    const response = errorResponse(403, { error: 'Forbidden', code: 'ACCESS_DENIED' });

    await expect(handleResponse(response)).rejects.toThrow(ApiError);
    await expect(
      handleResponse(errorResponse(403, { error: 'Forbidden', code: 'ACCESS_DENIED' })),
    ).rejects.toMatchObject({
      message: 'Forbidden',
      status: 403,
      code: 'ACCESS_DENIED',
    });
  });
});

describe('buildQueryString', () => {
  it('returns empty string for empty params', () => {
    expect(buildQueryString({})).toBe('');
  });

  it('serialises string, number, and boolean values', () => {
    const result = buildQueryString({ name: 'alice', page: 2, active: true });

    expect(result).toContain('?');
    const params = new URLSearchParams(result.slice(1));
    expect(params.get('name')).toBe('alice');
    expect(params.get('page')).toBe('2');
    expect(params.get('active')).toBe('true');
  });

  it('omits undefined and null values', () => {
    const result = buildQueryString({ name: 'bob', missing: undefined, empty: null });

    const params = new URLSearchParams(result.slice(1));
    expect(params.get('name')).toBe('bob');
    expect(params.has('missing')).toBe(false);
    expect(params.has('empty')).toBe(false);
  });

  it('returns string starting with ? when params exist', () => {
    const result = buildQueryString({ key: 'value' });

    expect(result).toMatch(/^\?/);
  });
});
