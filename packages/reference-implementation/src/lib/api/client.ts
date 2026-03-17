// ── Error type ───────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Response helpers ─────────────────────────────────────────────────────────

export async function throwApiError(response: Response): Promise<never> {
  let error = response.statusText;
  let code: string | undefined;
  try {
    const body = await response.json();
    if (body.error) error = body.error;
    if (body.code) code = body.code;
  } catch {
    // Use statusText as fallback
  }
  throw new ApiError(error, response.status, code);
}

export async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    await throwApiError(response);
  }
  return response.json() as Promise<T>;
}
