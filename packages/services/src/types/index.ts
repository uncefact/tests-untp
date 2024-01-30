/* eslint-disable @typescript-eslint/no-explicit-any */
import { CredentialSubject } from '@vckit/core-types';
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

export interface IArgIssueVC {
  credentialPayload: any;
  credentialSubject: CredentialSubject;
}
