import { createLogger } from '@uncefact/untp-ri-services/logging';

const logger = createLogger().child({ module: 'group-claim' });

export interface GroupClaimConfig {
  claimName: string;
  claimFormat: 'array_first' | 'string';
}

export function extractGroupClaim(payload: Record<string, unknown>, config: GroupClaimConfig): string | null {
  const raw = payload[config.claimName];

  if (raw === undefined || raw === null) {
    return null;
  }

  if (config.claimFormat === 'array_first') {
    if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === 'string') {
      if (raw.length > 1) {
        logger.warn(
          { claimName: config.claimName, groupCount: raw.length },
          'Multiple groups found in token — using first',
        );
      }
      return raw[0];
    }
    return null;
  }

  if (config.claimFormat === 'string') {
    return typeof raw === 'string' ? raw : null;
  }

  return null;
}
