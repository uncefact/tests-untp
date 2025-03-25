import handlebars from 'handlebars';
import { PermittedCredentialType } from '@/types';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { reportTemplates } from '@/types/templates';
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
 * Reads a Handlebars template file and returns its content as a string.
 * @param {string} templateName - The name of the template file (without the .hbs extension).
 * @returns A promise that resolves to the content of the template file as a string.
 */
export const readTemplate = async (templateName: string): Promise<string> => {
  const template = reportTemplates[templateName as keyof typeof reportTemplates];
  if (!template) {
    throw new Error(`Template "${templateName}" not found`);
  }
  return template;
};

/**
 * Downloads an HTML report with the provided data.
 * @param data The data to display in the report.
 * @param filename The name of the file to download.
 */
export const downloadHtml = async (
  data: Record<string, any>,
  filename: string,
  templateName: string = 'UNTP_REPORT',
) => {
  if (!filename.endsWith('.html')) {
    filename = `${filename}.html`;
  }

  try {
    const templateContent = await readTemplate(templateName);
    const template = handlebars.compile(templateContent);
    const html = template({ credentialSubject: data });
    downloadFile(html, filename, 'text/html');
  } catch (error) {
    throw new Error('Failed to download HTML report');
  }
};
