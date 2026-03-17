import type { PaginatedResponse } from '@/lib/api/pagination';
import type { DidType, DidMethod, DidStatus, DidDocument, DidVerificationResult } from '@uncefact/untp-ri-services';

// ── Types ────────────────────────────────────────────────────────────────────

/** Serialised DID record as returned by the API (dates are ISO strings). */
export interface DidRecord {
  id: string;
  tenantId: string;
  did: string;
  type: DidType;
  method: DidMethod;
  name: string;
  description: string | null;
  keyId: string;
  status: DidStatus;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  serviceInstanceId: string | null;
}

export interface ListDidsParams {
  type?: DidType;
  status?: DidStatus;
  serviceInstanceId?: string;
  limit?: number;
  offset?: number;
}

export interface CreateDidInput {
  type: DidType;
  method: DidMethod;
  alias: string;
  name?: string;
  description?: string;
  isDefault?: boolean;
  serviceInstanceId?: string;
}

export interface UpdateDidInput {
  name?: string;
  description?: string;
  isDefault?: boolean;
}

export interface VerifyDidResponse {
  verification: DidVerificationResult;
  did: DidRecord;
}

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

const BASE_PATH = '/api/v1/dids';

async function handleResponse<T>(response: Response): Promise<T> {
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
  return response.json() as Promise<T>;
}

function buildQueryString(params: Record<string, string | number | boolean | undefined | null>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

// ── Service functions ────────────────────────────────────────────────────────

export async function listDids(params?: ListDidsParams): Promise<PaginatedResponse<DidRecord>> {
  const qs = params ? buildQueryString({ ...params }) : '';
  const response = await fetch(`${BASE_PATH}${qs}`);
  return handleResponse<PaginatedResponse<DidRecord>>(response);
}

export async function getDid(id: string): Promise<DidRecord> {
  const response = await fetch(`${BASE_PATH}/${id}`);
  return handleResponse<DidRecord>(response);
}

export async function createDid(input: CreateDidInput): Promise<DidRecord> {
  const response = await fetch(BASE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handleResponse<DidRecord>(response);
}

export async function updateDid(id: string, input: UpdateDidInput): Promise<DidRecord> {
  const response = await fetch(`${BASE_PATH}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handleResponse<DidRecord>(response);
}

export async function deleteDid(id: string): Promise<void> {
  const response = await fetch(`${BASE_PATH}/${id}`, { method: 'DELETE' });
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

export async function getDidDocument(id: string): Promise<DidDocument> {
  const response = await fetch(`${BASE_PATH}/${id}/document`);
  return handleResponse<DidDocument>(response);
}

export async function verifyDid(id: string): Promise<VerifyDidResponse> {
  const response = await fetch(`${BASE_PATH}/${id}/verify`, { method: 'POST' });
  return handleResponse<VerifyDidResponse>(response);
}
