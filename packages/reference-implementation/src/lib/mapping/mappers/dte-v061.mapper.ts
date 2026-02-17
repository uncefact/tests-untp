import { ICredentialMapper, ResolvedEntities, ExtractedIdentifierRefs, DataModelConfig, MapperOutput } from '../types';
import { registerMapper } from '../mapper-registry';

// TODO: Consolidate shared types and helpers across v0.6.1 mappers into a
// common module (e.g. ./shared-v061.ts). Candidates:
//   - Party type (DccParty, DfrParty) and buildParty helper
//   - IdentifierScheme type import and buildIdentifierScheme helper (identical in DCC, DFR, DIA)
//   - Context/type array construction logic (identical in all four mappers)

/**
 * DTE v0.6.1 UNTP schema types.
 * These mirror the JSON schema definitions for the Digital Traceability Event.
 */
type DteItem = {
  type: ['Item'];
  id: string | undefined;
  name: string | undefined;
};

/**
 * Mapper for Digital Traceability Event v0.6.1.
 * Builds a UNTP DTE credential payload from product and organisation entities.
 *
 * Output structure follows the UNTP DTE JSON schema:
 *   - credentialSubject is an Event
 *   - product maps to an Item in epcList
 *   - organisation is referenced via the credential issuer (handled downstream)
 *
 * Note: DTE events are polymorphic (TransformationEvent, ObjectEvent, etc.)
 * and event-specific fields (processType, eventTime, action, etc.) are not
 * derived from entity resolution. This mapper provides the entity-derived
 * skeleton; event details are populated separately during credential issuance.
 */
export class DteV061Mapper implements ICredentialMapper {
  async buildPayload(entities: ResolvedEntities, config: DataModelConfig): Promise<MapperOutput> {
    const { product } = entities;

    const contexts: string[] = [config.core.contextUrl];
    const types: string[] = [config.core.credentialType];

    if (config.extension) {
      contexts.push(config.extension.contextUrl);
      if (config.extension.credentialType !== config.core.credentialType) {
        types.push(config.extension.credentialType);
      }
    }

    return {
      '@context': contexts,
      type: types,
      credentialSubject: {
        type: ['Event'],
        ...(product ? { epcList: [this.buildItem(product)] } : {}),
      },
    };
  }

  private buildItem(product: NonNullable<ResolvedEntities['product']>): DteItem {
    return {
      type: ['Item'],
      id: product.id,
      name: product.name,
    };
  }

  extractEntityRefs(payload: MapperOutput): ExtractedIdentifierRefs {
    const subject = payload.credentialSubject;
    if (!subject) return {};

    const epcList = subject.epcList as DteItem[] | undefined;
    if (!epcList || epcList.length === 0) return {};

    const refs: ExtractedIdentifierRefs = {};

    const firstItem = epcList[0];
    if (firstItem?.id) {
      refs.product = { registeredId: firstItem.id };
    }

    return refs;
  }
}

// Self-register on import
registerMapper('DigitalTraceabilityEvent', '0.6.1', new DteV061Mapper());
