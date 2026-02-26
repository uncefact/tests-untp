export type TenantMode = 'open' | 'closed';
export type ClaimFormat = 'array_first' | 'string';

export interface TenantConfigOpen {
  mode: 'open';
}

export interface TenantConfigClosed {
  mode: 'closed';
  claimName: string;
  claimFormat: ClaimFormat;
}

export type TenantConfig = TenantConfigOpen | TenantConfigClosed;

const VALID_MODES: TenantMode[] = ['open', 'closed'];
const VALID_FORMATS: ClaimFormat[] = ['array_first', 'string'];

export function getTenantConfig(): TenantConfig {
  const mode = (process.env.TENANT_MODE ?? 'open') as string;

  if (!VALID_MODES.includes(mode as TenantMode)) {
    throw new Error(`Invalid TENANT_MODE: "${mode}". Must be one of: ${VALID_MODES.join(', ')}`);
  }

  if (mode === 'open') {
    return { mode: 'open' };
  }

  const claimFormat = (process.env.TENANT_CLAIM_FORMAT ?? 'array_first') as string;
  if (!VALID_FORMATS.includes(claimFormat as ClaimFormat)) {
    throw new Error(`Invalid TENANT_CLAIM_FORMAT: "${claimFormat}". Must be one of: ${VALID_FORMATS.join(', ')}`);
  }

  return {
    mode: 'closed',
    claimName: process.env.TENANT_CLAIM_NAME ?? 'groups',
    claimFormat: claimFormat as ClaimFormat,
  };
}
