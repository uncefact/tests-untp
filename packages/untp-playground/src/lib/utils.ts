import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { VCDM_CONTEXT_URLS, VCDMVersion } from '../../constants';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Detects the VCDM version of a VerifiableCredential.
 * @param credential - The VerifiableCredential to detect the version of.
 * @returns The detected VCDM version.
 */
export function detectVcdmVersion(credential: Record<string, any>): VCDMVersion {
  if (!credential) {
    return VCDMVersion.UNKNOWN;
  }

  const context = credential['@context'];
  if (!Array.isArray(context) || context.length === 0) {
    return VCDMVersion.UNKNOWN;
  }

  switch (context[0]) {
    case VCDM_CONTEXT_URLS.v1:
      return VCDMVersion.V1;
    case VCDM_CONTEXT_URLS.v2:
      return VCDMVersion.V2;
    default:
      return VCDMVersion.UNKNOWN;
  }
}
