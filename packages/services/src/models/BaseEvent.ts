import { VerifiableCredential } from '@vckit/core-types';
import { IVcKitIssueVC, integrateVckitIssueVC } from '../vckit.service';

/**
 * @description BaseEvent class is the base class for the events extending the class
 * @param template - template for the event
 * @param schema - schema for the event
 */
export abstract class BaseEvent {
  private template?: any;
  private schema?: any;

  constructor(template?: any, schema?: any) {
    this.template = template;
    this.schema = schema;
  }

  /**
   * @description createEvent method is used to create the event
   * @param arg - arguments for the event
   */
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

  /**
   * @description issueVC method is used to issue the VC
   * @param arg - arguments for the VC
   */
  async issueVC(arg: IVcKitIssueVC): Promise<VerifiableCredential> {
    try {
      const { credentialPayload, credentialSubject, issuer, restOfVC, context, vcKitAPIUrl } = arg;
      const credentialValue: VerifiableCredential = await integrateVckitIssueVC({
        context,
        credentialSubject,
        ...credentialPayload,
        issuer,
        restOfVC,
        vcKitAPIUrl,
      });

      return credentialValue;
    } catch (error) {
      throw error;
    }
  }
}
