import type { ICvcParser } from './types.js';
import { CvcV070Parser } from './parsers/cvc-v070.parser.js';

const parsers: Record<string, ICvcParser> = {
  '0.7.0': new CvcV070Parser(),
};

export const SUPPORTED_CVC_VERSIONS = Object.keys(parsers);

export function getCvcParser(version: string): ICvcParser | undefined {
  return parsers[version];
}
