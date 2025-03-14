import { PermittedCredentialType } from '@/types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { CredentialType, permittedCredentialTypes, VCDM_CONTEXT_URLS, VCDMVersion } from '../../constants';

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

export function isPermittedCredentialType(type: CredentialType): type is PermittedCredentialType {
  return permittedCredentialTypes.includes(type as PermittedCredentialType);
}

export const downloadJson = (data: Record<string, any>, filename: string) => {
  if (!filename.endsWith('.json')) {
    filename = `${filename}.json`;
  }

  try {
    // Verify data is JSON-serializable
    JSON.stringify(data);

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    throw new Error('Data is not JSON-serializable');
  }
};

/**
 * Returns the type of the given value as a string.
 *
 * This function uses `Object.prototype.toString` to get the internal
 * [[Class]] property of the value, which is a more reliable way to
 * determine the type of an object than using `typeof` or `instanceof`.
 *
 * The result is a string such as "String", "Number", "Array", "Object", etc.
 *
 * @param value - The value whose type is to be determined.
 * @returns The type of the value as a string.
 */
export const typeOf = (value: any) => Object.prototype.toString.call(value).slice(8, -1);

export const validateNormalizedCredential = (normalizedCredential: any) => {
  if (Array.isArray(normalizedCredential)) {
    return {
      keyword: 'type',
      instancePath: 'array',
      params: {
        type: 'object',
        receivedValue: normalizedCredential,
        solution: 'Instead of [credential1, credential2], upload credential1.json and credential2.json.',
      },
      message: 'Credentials must be uploaded as separate files, not as an array.',
    };
  }

  if (!normalizedCredential || typeof normalizedCredential !== 'object') {
    return {
      keyword: 'type',
      instancePath: 'invalid',
      params: {
        type: 'object',
        receivedValue: normalizedCredential,
        solution: 'Upload a valid credential file.',
      },
      message: 'Invalid credential file.',
    };
  }

  return null; // No errors
};

export const findDuplicates = (arr1: Iterable<unknown> | null | undefined, arr2: any[]) => {
  const set1 = new Set(arr1);
  const duplicates = arr2.filter((item) => set1.has(item));
  return duplicates;
};
