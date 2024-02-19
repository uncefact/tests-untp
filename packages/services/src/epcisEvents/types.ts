export interface IVCKitContext {
  vckitAPIUrl: string;
  type: string[];
  context: string[];
  renderTemplate: string[];
  issuer: string;
}
export interface ILinkResolverContext {
  identificationKeyType: string;
  linkTitle: string;
  verificationPage: string;
  dlrAPIUrl: string;
  dlrAPIKey: string;
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
