import { IdentificationKeyType } from '../linkResolver.service';
import { StorageServiceConfig } from '../types';
import { IConstructObjectParameters } from '../utils/helpers';

export interface IVCKitContext {
  issuer: string;
  vckitAPIUrl: string;
}

export interface ICredential {
  context: string[];
  type: string[];
  renderTemplate?: IRenderer[];
}

export interface ILinkResolverContext {
  dlrIdentificationKeyNamespace: string;
  dlrIdentificationKeyType: IdentificationKeyType;
  dlrLinkTitle: string;
  dlrVerificationPage: string;
  dlrQualifierPath: '';
}

export interface IEntityIssue extends ICredential, ILinkResolverContext {
  dlrAIs?: IDLRAI;
  [key: string]: any; // TODO: define the specific properties
}

export interface IDLRAI {
  [key: string]: string;
}

export interface IConfigDLR {
  dlrAPIUrl: string;
  dlrAPIKey: string;
  namespace: string;
}

export interface IStorageContext {
  storageAPIUrl: string;
  bucket: string;
}
export interface IContext {
  vckit: IVCKitContext;
  dlr: IConfigDLR;
  storage: StorageServiceConfig;
  identifierKeyPath: string;
  dpp: IEntityIssue;
}

export interface IRenderer {
  template: string;
  '@type': string;
}

export interface IInputItems {
  quantity: number;
  uom: string;
  productClass: string;
}

export interface ITransformationEvent extends IContext {
  identifiers: string[];
  epcisTransformationEvent: IEntityIssue;
  transformationEventCredential: IConstructObjectParameters;
  dppCredentials: IConstructObjectParameters[];
  identifierKeyPath: string;
}

export interface ITraceabilityEvent {
  data: {
    [key: string]: any;
  };
}

export interface ITransactionEventContext extends IContext {
  epcisTransactionEvent: IEntityIssue;
  localStorageParams: any;
}

export interface IAggregationEvent {
  data: {
    [key: string]: any;
  };
}

export interface IAggregationEventContext extends IContext {
  epcisAggregationEvent: IEntityIssue;
}
