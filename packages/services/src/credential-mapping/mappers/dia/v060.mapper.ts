import type {
  ICredentialMapper,
  ResolvedEntities,
  ExtractedIdentifierRefs,
  DataModelConfig,
  MapperOutput,
} from '../../types.js';
import { buildIdentifierScheme, buildContextAndTypes } from '../shared/v060.js';

export class DiaV060Mapper implements ICredentialMapper {
  async buildPayload(entities: ResolvedEntities, config: DataModelConfig): Promise<MapperOutput> {
    const { organisation } = entities;
    const { contexts, types } = buildContextAndTypes(config);

    return {
      '@context': contexts,
      type: types,
      credentialSubject: {
        type: ['RegisteredIdentity'],
        id: organisation?.id,
        name: organisation?.name,
        ...(organisation?.primaryIdentifier && {
          registeredId: organisation.primaryIdentifier.value,
          idScheme: buildIdentifierScheme(organisation.primaryIdentifier.scheme),
        }),
      },
    };
  }

  extractEntityRefs(payload: MapperOutput): ExtractedIdentifierRefs {
    const subject = payload.credentialSubject;
    if (!subject) return {};

    const registeredId = subject.registeredId as string | undefined;
    if (!registeredId) return {};

    return {
      primaryIdentifier: registeredId,
      organisation: { registeredId },
    };
  }
}
