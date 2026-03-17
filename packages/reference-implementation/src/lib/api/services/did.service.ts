import type { Did } from '@/lib/prisma/generated';
import type { PaginatedResponse } from '@/lib/api/pagination';
import type { DidType, DidMethod, DidStatus, DidDocument, DidVerificationResult } from '@uncefact/untp-ri-services';

// ── Error class ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ── Request / response types ─────────────────────────────────────────────────

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
  did: Did;
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
      // Non-JSON error body — keep statusText as the message.
    }
    throw new ApiError(response.status, message, code);
  }
  return response.json() as Promise<T>;
}

// ── Service functions ────────────────────────────────────────────────────────

export async function listDids(params?: ListDidsParams): Promise<PaginatedResponse<Did>> {
  const url = new URL(BASE_PATH, window.location.origin);
  if (params) {
    if (params.type !== undefined) url.searchParams.set('type', params.type);
    if (params.status !== undefined) url.searchParams.set('status', params.status);
    if (params.serviceInstanceId !== undefined) url.searchParams.set('serviceInstanceId', params.serviceInstanceId);
    if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit));
    if (params.offset !== undefined) url.searchParams.set('offset', String(params.offset));
  }
  const response = await fetch(url.toString());
  return handleResponse<PaginatedResponse<Did>>(response);
}

export async function getDid(id: string): Promise<Did> {
  const response = await fetch(`${BASE_PATH}/${id}`);
  return handleResponse<Did>(response);
}

export async function createDid(input: CreateDidInput): Promise<Did> {
  const response = await fetch(BASE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handleResponse<Did>(response);
}

export async function updateDid(id: string, input: UpdateDidInput): Promise<Did> {
  const response = await fetch(`${BASE_PATH}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return handleResponse<Did>(response);
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
      // Non-JSON error body — keep statusText as the message.
    }
    throw new ApiError(response.status, message, code);
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
