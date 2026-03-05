import type { ICredentialMapper } from './types.js';
import { DppV060Mapper } from './mappers/dpp/v060.mapper.js';
import { DppV061Mapper } from './mappers/dpp/v061.mapper.js';
import { DccV060Mapper } from './mappers/dcc/v060.mapper.js';
import { DccV061Mapper } from './mappers/dcc/v061.mapper.js';
import { DfrV060Mapper } from './mappers/dfr/v060.mapper.js';
import { DfrV061Mapper } from './mappers/dfr/v061.mapper.js';
import { DiaV060Mapper } from './mappers/dia/v060.mapper.js';
import { DiaV061Mapper } from './mappers/dia/v061.mapper.js';
import { DteV060Mapper } from './mappers/dte/v060.mapper.js';
import { DteV061Mapper } from './mappers/dte/v061.mapper.js';

const mappers: Record<string, Record<string, ICredentialMapper>> = {
  DigitalProductPassport: { '0.6.0': new DppV060Mapper(), '0.6.1': new DppV061Mapper() },
  DigitalConformityCredential: { '0.6.0': new DccV060Mapper(), '0.6.1': new DccV061Mapper() },
  DigitalFacilityRecord: { '0.6.0': new DfrV060Mapper(), '0.6.1': new DfrV061Mapper() },
  DigitalIdentityAnchor: { '0.6.0': new DiaV060Mapper(), '0.6.1': new DiaV061Mapper() },
  DigitalTraceabilityEvent: { '0.6.0': new DteV060Mapper(), '0.6.1': new DteV061Mapper() },
};

export function getMapper(credentialType: string, version: string): ICredentialMapper | undefined {
  return mappers[credentialType]?.[version];
}
