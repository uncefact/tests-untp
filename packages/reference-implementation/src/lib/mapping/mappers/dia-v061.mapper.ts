import { ICredentialMapper, ResolvedEntities, ExtractedIdentifierRefs, DataModelConfig, MapperOutput } from '../types';
import { registerMapper } from '../mapper-registry';
import type { IdentifierScheme } from '@uncefact/untp-ri-services';

// TODO: Consolidate shared types and helpers across v0.6.1 mappers into a
// common module (e.g. ./shared-v061.ts). Candidates:
//   - Party type (DccParty, DfrParty) and buildParty helper
//   - IdentifierScheme type import and buildIdentifierScheme helper (identical in DCC, DFR, DIA)
//   - Context/type array construction logic (identical in all four mappers)

/**
 * Mapper for Digital Identity Anchor v0.6.1.
 * Builds a UNTP DIA credential payload from the organisation entity.
 *
 * Output structure follows the UNTP DIA JSON schema:
 *   - credentialSubject is a RegisteredIdentity
 *   - organisation identity fields map directly to the top level
 */
export class DiaV061Mapper implements ICredentialMapper {
  async buildPayload(entities: ResolvedEntities, config: DataModelConfig): Promise<MapperOutput> {
    const { organisation } = entities;

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
        type: ['RegisteredIdentity'],
        id: organisation?.id,
        name: organisation?.name,
        ...(organisation?.primaryIdentifier && {
          registeredId: organisation.primaryIdentifier.value,
          idScheme: this.buildIdentifierScheme(organisation.primaryIdentifier.scheme),
        }),
      },
    };
  }

  private buildIdentifierScheme(
    scheme: { id?: string; name?: string } | null | undefined,
  ): IdentifierScheme | undefined {
    if (!scheme || !scheme.id || !scheme.name) return undefined;
    return {
      type: ['IdentifierScheme'],
      id: scheme.id,
      name: scheme.name,
    };
  }

  extractEntityRefs(payload: MapperOutput): ExtractedIdentifierRefs {
    const subject = payload.credentialSubject;
    if (!subject) return {};

    const registeredId = subject.registeredId as string | undefined;
    if (!registeredId) return {};

    return {
      organisation: { registeredId },
    };
  }
}

// Self-register on import
registerMapper('DigitalIdentityAnchor', '0.6.1', new DiaV061Mapper());
