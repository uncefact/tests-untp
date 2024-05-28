import { CredentialPayload } from '@vckit/core-types';

export interface IssueEvent {
  eventType: 'issue_event';
  credentialPayload: CredentialPayload;
  credentialSubject: any;
  restOfVC: any;
}

export interface IImportedData {
  [key: string]: { value: any, checked: boolean };
}

export enum MimeTypeEnum {
  textPlain = 'text/plain',
  textHtml = 'text/html',
  applicationJson = 'application/json',
}

export enum SupportedProviderTypesEnum {
  gs1 = 'gs1',
}