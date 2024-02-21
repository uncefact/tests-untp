export interface IVCKitContext {
  type: string[];
  context: string[];
  renderTemplate: IRenderer[];
  issuer: string;
  vckitAPIUrl: string;
}
export interface ILinkResolverContext {
  identificationKeyType: string;
  linkTitle: string;
  verificationPage: string;
  dlrAPIUrl: string;
  dlrAPIKey: string;

  [key: string]: string;
}
export interface IStorageContext {
  storageAPIUrl: string;
  bucket: string;
}
export interface IContext {
  vckit: IVCKitContext;
  dlr: ILinkResolverContext;
  storage: IStorageContext;
  identifierKeyPaths: string[];
}

export interface IInputItems {
  quantity: number;
  uom: string;
  productClass: string;
}

export interface IProductTransformation {
  inputItems: IInputItems[];
  outputItems: any;
}

export interface ITransFormaionEvent extends IContext {
  gtins: string[];
  epcisVckit: IVCKitContext;
  dppVckit: IVCKitContext;
  productTranformation: IProductTransformation;
}

export interface IRenderer {
  template: string;
  '@type': string;
}
