import type { DidDocument } from '@uncefact/untp-ri-services';
import type { PaginatedResponse } from '@/lib/api/pagination';
import { handleResponse, throwIfNotOk, buildQueryString } from './client';
import type { DidRecord, ListDidsParams, CreateDidInput, UpdateDidInput, VerifyDidResponse } from './did.types';

export type { DidRecord, ListDidsParams, CreateDidInput, UpdateDidInput, VerifyDidResponse } from './did.types';
export { ApiError } from './client';

// ── Service functions ────────────────────────────────────────────────────────

const BASE_PATH = '/api/v1/dids';

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
  await throwIfNotOk(response);
}

export async function getDidDocument(id: string): Promise<DidDocument> {
  const response = await fetch(`${BASE_PATH}/${id}/document`);
  return handleResponse<DidDocument>(response);
}

export async function verifyDid(id: string): Promise<VerifyDidResponse> {
  const response = await fetch(`${BASE_PATH}/${id}/verify`, { method: 'POST' });
  return handleResponse<VerifyDidResponse>(response);
}
