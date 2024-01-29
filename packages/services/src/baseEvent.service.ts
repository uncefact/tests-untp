import { VerifiableCredential } from '@vckit/core-types';
import { IVcKitIssueVC, integrateVckitIssueVC } from './vckit.service';

export class BaseEvent {
  private template?: any;
  private schema?: any;

  constructor(template?: any, schema?: any) {
    this.template = template;
    this.schema = schema;
  }

  public createEvent(arg) {
    const { eventType } = arg;
    switch (eventType) {
      case 'object_event':
        break;
      case 'transformation_event':
        break;
      case 'aggregation_event':
        break;
      case 'transaction_event':
        break;
      default:
        break;
    }
  }

  public async issueEvent(arg: IVcKitIssueVC) {
    try {
      const { credentialPayload, credentialSubject, restOfVC, context, vcKitAPIUrl } = arg;
      const credentialValue: VerifiableCredential = await integrateVckitIssueVC({
        context,
        credentialSubject,
        ...credentialPayload,
        restOfVC,
        vcKitAPIUrl,
      });

      return credentialValue;
    } catch (error) {
      throw error;
    }
  }
}
