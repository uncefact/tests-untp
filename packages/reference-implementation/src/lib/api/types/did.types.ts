import type { Did } from '@/lib/prisma/generated';
import type {
  DidType,
  DidMethod,
  DidStatus,
  DidVerificationResult,
  CREATABLE_DID_TYPES,
} from '@uncefact/untp-ri-services';

export type CreatableDidType = (typeof CREATABLE_DID_TYPES)[number];

// ── Request types ──────────────────────────────────────────────────────────

export interface ListDidsParams {
  type?: DidType;
  status?: DidStatus;
  serviceInstanceId?: string;
  limit?: number;
  offset?: number;
}

export interface CreateDidInput {
  type: CreatableDidType;
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

// ── Response types ─────────────────────────────────────────────────────────

export interface VerifyDidResponse {
  verification: DidVerificationResult;
  did: Did;
}
