import { makeBridge } from './make-bridge.js';
import type { IDataModelBridge } from './types.js';
import { dppV060Spec } from './data-models/dpp/versions/v060.js';
import { dppV061Spec } from './data-models/dpp/versions/v061.js';
import { dccV060Spec } from './data-models/dcc/versions/v060.js';
import { dccV061Spec } from './data-models/dcc/versions/v061.js';
import { dfrV060Spec } from './data-models/dfr/versions/v060.js';
import { dfrV061Spec } from './data-models/dfr/versions/v061.js';
import { diaV060Spec } from './data-models/dia/versions/v060.js';
import { diaV061Spec } from './data-models/dia/versions/v061.js';
import { dteV060Spec } from './data-models/dte/versions/v060.js';
import { dteV061Spec } from './data-models/dte/versions/v061.js';

const registry: Record<string, Record<string, IDataModelBridge>> = {
  DigitalProductPassport: {
    '0.6.0': makeBridge(dppV060Spec),
    '0.6.1': makeBridge(dppV061Spec),
  },
  DigitalConformityCredential: {
    '0.6.0': makeBridge(dccV060Spec),
    '0.6.1': makeBridge(dccV061Spec),
  },
  DigitalFacilityRecord: {
    '0.6.0': makeBridge(dfrV060Spec),
    '0.6.1': makeBridge(dfrV061Spec),
  },
  DigitalIdentityAnchor: {
    '0.6.0': makeBridge(diaV060Spec),
    '0.6.1': makeBridge(diaV061Spec),
  },
  DigitalTraceabilityEvent: {
    '0.6.0': makeBridge(dteV060Spec),
    '0.6.1': makeBridge(dteV061Spec),
  },
};

export function getBridge(dataModelType: string, version: string): IDataModelBridge | undefined {
  return registry[dataModelType]?.[version];
}
