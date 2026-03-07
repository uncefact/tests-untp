'use client';

import { Buffer } from 'buffer';
if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
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
