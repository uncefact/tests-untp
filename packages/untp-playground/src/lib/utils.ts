

import handlebars from 'handlebars';
import { PermittedCredentialType } from '@/types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import templateContent from '@/lib/templates/untp-comformance-report-template.hbs';

import { CredentialType, permittedCredentialTypes, VCDM_CONTEXT_URLS, VCDMVersion } from '../../constants';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function isPermittedCredentialType(type: CredentialType): type is PermittedCredentialType {
  return permittedCredentialTypes.includes(type);
}

const downloadFile = (content: string, filename: string, mimeType: string) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

export const downloadJson = (data: Record<string, any>, filename: string) => {
  if (!filename.endsWith('.json')) {
    filename = `${filename}.json`;
  }

  try {
    // Verify data is JSON-serializable
    const jsonContent = JSON.stringify(data, null, 2);
    downloadFile(jsonContent, filename, 'application/json');
  } catch (error) {
    throw new Error('Data is not JSON-serializable');
  }
};

/**
 * Downloads an HTML report with the provided data.
 * @param data The data to display in the report.
 * @param filename The name of the file to download.
 */
export const downloadHtml = async (data: Record<string, any>, filename: string) => {
  if (!filename.endsWith('.html')) {
    filename = `${filename}.html`;
  }

  try {
    const handlebars = (await import('handlebars')).default;
    const template = handlebars.compile(templateContent);
    const html = template({ credentialSubject: data });
    downloadFile(html, filename, 'text/html');
  } catch (error) {
    throw new Error('Failed to download HTML report');
  }
};

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
