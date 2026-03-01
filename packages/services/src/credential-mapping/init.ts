import { registerMapper } from './mapper-registry.js';
import { DppV061Mapper } from './mappers/dpp-v061.mapper.js';
import { DccV061Mapper } from './mappers/dcc-v061.mapper.js';
import { DfrV061Mapper } from './mappers/dfr-v061.mapper.js';
import { DiaV061Mapper } from './mappers/dia-v061.mapper.js';
import { DteV061Mapper } from './mappers/dte-v061.mapper.js';

/**
 * Registers all built-in credential type mappers.
 * Call during application startup before using the mapper registry.
 *
 * Safe to call multiple times; subsequent calls replace mapper
 * instances with fresh ones.
 */
export function initBuiltInMappers(): void {
  registerMapper('DigitalProductPassport', '0.6.1', new DppV061Mapper());
  registerMapper('DigitalConformityCredential', '0.6.1', new DccV061Mapper());
  registerMapper('DigitalFacilityRecord', '0.6.1', new DfrV061Mapper());
  registerMapper('DigitalIdentityAnchor', '0.6.1', new DiaV061Mapper());
  registerMapper('DigitalTraceabilityEvent', '0.6.1', new DteV061Mapper());
}
