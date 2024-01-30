import { VerifiableCredential } from '@vckit/core-types';
import { integrateVckitIssueVC } from '../vckit.service';
import { IArgIssueEvent, IBaseEvent, IRender } from '../types/BaseEvent.types';

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
   * @description issueEvent method is used to issue the VC
   * @param arg - arguments for the VC
   */
  async issueEvent(arg: IArgIssueEvent): Promise<VerifiableCredential> {
    try {
      const restOfVC = { render: this.renderTemplate };
      const { credentialPayload, credentialSubject, type } = arg;
      const credentialValue: VerifiableCredential = await integrateVckitIssueVC({
        context: this.context,
        credentialSubject,
        issuer: this.issuer,
        type: [...this.eventType, ...(type ?? [])],
        vcKitAPIUrl: this.vcKitAPIUrl,
        credentialPayload,
        ...restOfVC,
      });

      return credentialValue;
    } catch (error) {
      throw error;
    }
  }
}
