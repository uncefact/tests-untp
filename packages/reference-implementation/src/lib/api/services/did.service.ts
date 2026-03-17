import type { Did } from '@/lib/prisma/generated';
import type { PaginatedResponse } from '@/lib/api/pagination';
import type { DidDocument } from '@uncefact/untp-ri-services';
import type { ListDidsParams, CreateDidInput, UpdateDidInput, VerifyDidResponse } from '@/lib/api/types/did.types';
import { handleResponse, throwApiError } from '@/lib/api/client';

// ── Service functions ────────────────────────────────────────────────────────

const BASE_PATH = '/api/v1/dids';

export async function listDids(params?: ListDidsParams): Promise<PaginatedResponse<Did>> {
  const searchParams = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  const url = query ? `${BASE_PATH}?${query}` : BASE_PATH;
  const response = await fetch(url);
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
    await throwApiError(response);
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
