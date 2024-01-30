import { VerifiableCredential } from '@vckit/core-types';
import { integrateVckitIssueVC } from '../vckit.service';
import { IArgIssueVC, IBaseEvent, IRender } from '../types';

/**
 * @description BaseEvent class is the base class for the events extending the class
 * @param renderTemplate - render template for the event
 * @param context - context for the event
 * @param issuer - issuer for the event
 * @param vcKitAPIUrl - api url for the event
 * @param eventType - type of the event
 */
export abstract class BaseEvent {
  readonly renderTemplate?: IRender;
  readonly context?: string[];
  readonly issuer: string;
  readonly vcKitAPIUrl: string;
  readonly eventType: string;

  constructor({ renderTemplate, context, issuer, vcKitAPIUrl, eventType }: IBaseEvent) {
    this.renderTemplate = renderTemplate;
    this.context = context;
    this.issuer = issuer;
    this.vcKitAPIUrl = vcKitAPIUrl;
    this.eventType = eventType;
  }

  /**
   * @description createEvent method is used to create the event
   */
  // TODO: put to case correct eventType
  public createEvent() {
    switch (this.eventType) {
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
  async issueVC(arg: IArgIssueVC): Promise<VerifiableCredential> {
    try {
      const restOfVC = { render: this.renderTemplate, type: this.eventType };
      const { credentialPayload, credentialSubject } = arg;
      const credentialValue: VerifiableCredential = await integrateVckitIssueVC({
        context: this.context,
        credentialSubject,
        ...credentialPayload,
        issuer: this.issuer,
        restOfVC,
        vcKitAPIUrl: this.vcKitAPIUrl,
      });

      return credentialValue;
    } catch (error) {
      throw error;
    }
  }
}
