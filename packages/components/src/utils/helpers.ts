import { BtnStyle } from '../types/index.js';

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
