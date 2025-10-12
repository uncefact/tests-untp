'use client';

import { Buffer } from 'buffer';
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
}

/*
  This utility function is designed to convert a string into a path.
  Example usage: 
  convertStringToPath("Issue DLP")
  > "issue-dlp"
*/
export function convertStringToPath(string: string) {
  // Convert to lowercase
  let path = string.toLowerCase();

  // Replace all non-alphanumeric characters with hyphens
  path = path.replace(/[^0-9a-zA-Z]+/g, '-');

  // Remove leading and trailing hyphens
  path = path.replace(/^-+|-+$/g, '');

  return path;
}

export function detectDevice(userAgent: string) {
  const userAgentLowerCase = userAgent.toLowerCase();

  if (/android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgentLowerCase)) {
    return 'mobile';
  }

  if (/mac|win/i.test(userAgentLowerCase)) {
    return 'laptop';
  }

  return 'unknown';
}

export function convertBase64ToString(base64: string) {
  return Buffer.from(base64, 'base64').toString('utf8');
}

export function convertPathToString(path: string) {
  // Remove leading '/'
  if (path.startsWith('/')) {
    path = path.substring(1);
  }

  // Get the first path segment
  path = path.split('/')[0];

  // Replace all hyphens with spaces
  let string = path.replace(/-/g, ' ');

  // Convert to title case
  string = string.replace(/\b\w/g, (l) => l.toUpperCase());

  return string;
}
