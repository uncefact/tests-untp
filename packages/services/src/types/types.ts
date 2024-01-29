import { CredentialPayload } from '@vckit/core-types';

export interface IssueEvent {
  credentialPayload: CredentialPayload;
  credentialSubject: any;
  restOfVC: any;
  context: string[];
}
