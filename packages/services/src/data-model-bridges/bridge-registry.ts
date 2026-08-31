import { makeBridge } from './make-bridge.js';
import type { IDataModelBridge } from './types.js';
import { dppV060Spec } from './data-models/dpp/versions/v060/index.js';
import { dppV061Spec } from './data-models/dpp/versions/v061/index.js';
import { dppV070Spec } from './data-models/dpp/versions/v070/index.js';
import { dccV060Spec } from './data-models/dcc/versions/v060/index.js';
import { dccV061Spec } from './data-models/dcc/versions/v061/index.js';
import { dccV070Spec } from './data-models/dcc/versions/v070/index.js';
import { dfrV060Spec } from './data-models/dfr/versions/v060/index.js';
import { dfrV061Spec } from './data-models/dfr/versions/v061/index.js';
import { dfrV070Spec } from './data-models/dfr/versions/v070/index.js';
import { diaV060Spec } from './data-models/dia/versions/v060/index.js';
import { diaV061Spec } from './data-models/dia/versions/v061/index.js';
import { diaV070Spec } from './data-models/dia/versions/v070/index.js';
import { dteV060Spec } from './data-models/dte/versions/v060/index.js';
import { dteV061Spec } from './data-models/dte/versions/v061/index.js';
import { dteV070Spec } from './data-models/dte/versions/v070/index.js';

const registry: Record<string, Record<string, IDataModelBridge>> = {
  DigitalProductPassport: {
    '0.6.0': makeBridge(dppV060Spec),
    '0.6.1': makeBridge(dppV061Spec),
    '0.7.0': makeBridge(dppV070Spec),
  },
  DigitalConformityCredential: {
    '0.6.0': makeBridge(dccV060Spec),
    '0.6.1': makeBridge(dccV061Spec),
    '0.7.0': makeBridge(dccV070Spec),
  },
  DigitalFacilityRecord: {
    '0.6.0': makeBridge(dfrV060Spec),
    '0.6.1': makeBridge(dfrV061Spec),
    '0.7.0': makeBridge(dfrV070Spec),
  },
  DigitalIdentityAnchor: {
    '0.6.0': makeBridge(diaV060Spec),
    '0.6.1': makeBridge(diaV061Spec),
    '0.7.0': makeBridge(diaV070Spec),
  },
  DigitalTraceabilityEvent: {
    '0.6.0': makeBridge(dteV060Spec),
    '0.6.1': makeBridge(dteV061Spec),
    '0.7.0': makeBridge(dteV070Spec),
  },
};

export function getBridge(dataModelType: string, version: string): IDataModelBridge | undefined {
  return registry[dataModelType]?.[version];
}

/**
 * Every data model and version the registry holds a bridge for.
 *
 * Package-internal: it exists so a test can assert it has a case for every
 * registered bridge, which is what stops a newly added version from going
 * unexercised. Callers that need the versions of one type should use
 * {@link listRegisteredVersions}.
 */
export function listBridgeVersions(): Array<{ dataModelType: string; version: string }> {
  return Object.entries(registry).flatMap(([dataModelType, versions]) =>
    Object.keys(versions).map((version) => ({ dataModelType, version })),
  );
}

/**
 * Spec versions the registry holds a bridge for under `dataModelType`.
 * Empty when the type is not registered.
 */
export function listRegisteredVersions(dataModelType: string): string[] {
  const versions = registry[dataModelType];
  return versions === undefined ? [] : Object.keys(versions);
}
