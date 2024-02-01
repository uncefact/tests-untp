/* eslint-disable @typescript-eslint/no-explicit-any */
import { CredentialSubject } from '@vckit/core-types';
import { IUploadedJson } from '../storage.service';
export interface IServices {
  (arg1: any, ...args: any[]): any;
}

export interface IRender {
  render: [
    {
      template: string;
      '@type': string;
    },
  ];
}

export interface IBaseEvent {
  renderTemplate?: IRender;
  context?: string[];
  issuer: string;
  vcKitAPIUrl: string;
  eventType: string;
}

export interface IArgIssueEvent {
  credentialPayload: unknown;
  credentialSubject: CredentialSubject;
  type?: string;
}

export interface IStorageEvent extends IUploadedJson {
  typeStorage: string;
}
