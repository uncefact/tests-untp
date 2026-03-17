import type { DidType, DidMethod, DidStatus, DidVerificationResult } from '@uncefact/untp-ri-services';

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
