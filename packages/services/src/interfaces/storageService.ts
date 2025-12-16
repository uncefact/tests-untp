import {
  Extensible
} from "@/types";

import {
  SignedVerifiableCredential
} from "./verifiableCredentialService";

export type StorageResponse = {
  uri: string;
  hash: string;
} & Extensible

export type StorageConfig = {
  url: string;
  params: { 
    bucket?: string;
  } & Extensible;
  options: {
    method: 'POST' | 'PUT';
    headers: Record<string, string>;
  } & Extensible;
} & Extensible;

export interface IStorageService {
  store(config: StorageConfig, crendential: SignedVerifiableCredential): Promise<StorageResponse>
}
