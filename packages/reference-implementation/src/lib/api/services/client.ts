// ── Error ────────────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

export async function throwIfNotOk(response: Response): Promise<void> {
  if (!response.ok) {
    let message = response.statusText;
    let code: string | undefined;
    try {
      const body = await response.json();
      if (body.error) message = body.error;
      if (body.code) code = body.code;
    } catch {
      // Non-JSON error body — use statusText
    }
    throw new ApiError(message, response.status, code);
  }
}

export async function handleResponse<T>(response: Response): Promise<T> {
  await throwIfNotOk(response);
  return response.json() as Promise<T>;
}

export function buildQueryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}
