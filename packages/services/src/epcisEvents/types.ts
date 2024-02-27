import { IdentificationKeyType } from '../linkResolver.service';

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
  dlrIdentificationKeyType: IdentificationKeyType;
  dlrLinkTitle: string;
  dlrVerificationPage: string;
  dlrQualifierPath: '';
}

export interface IEntityIssue extends ICredential, ILinkResolverContext {
  [key: string]: any; // TODO: define the specific properties
}

export interface IConfigDLR {
  dlrAPIUrl: string;
  dlrAPIKey: string;
}

export interface IStorageContext {
  storageAPIUrl: string;
  bucket: string;
}
export interface IContext {
  vckit: IVCKitContext;
  dlr: IConfigDLR;
  storage: IStorageContext;
  identifierKeyPaths: string[];
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

export interface IProductTransformation {
  inputItems: IInputItems[];
  outputItems: any[];
}

export interface ITransformationEvent extends IContext {
  identifiers: string[];
  epcisTransformationEvent: IEntityIssue;
  productTransformation: IProductTransformation;
}
