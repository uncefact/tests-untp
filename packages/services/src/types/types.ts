import { CredentialPayload } from '@vckit/core-types';

export interface IssueEvent {
  eventType: 'issue_event';
  credentialPayload: CredentialPayload;
  credentialSubject: any;
  restOfVC: any;
}

export interface IImportedData {
  label: string;
  value: any;
}

export enum MimeTypeEnum {
  textPlain = 'text/plain',
  textHtml = 'text/html',
  applicationJson = 'application/json',
}

export enum SupportedProviderTypesEnum {
  gs1 = 'gs1',
}