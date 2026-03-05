import type {
  ICredentialMapper,
  ResolvedEntities,
  ExtractedIdentifierRefs,
  DataModelConfig,
  MapperOutput,
} from '../../types.js';
import { buildContextAndTypes } from '../shared/v061.js';

type DteItem = {
  type: ['Item'];
  id: string | undefined;
  name: string | undefined;
};

export class DteV061Mapper implements ICredentialMapper {
  async buildPayload(entities: ResolvedEntities, config: DataModelConfig): Promise<MapperOutput> {
    const { product } = entities;
    const { contexts, types } = buildContextAndTypes(config);

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

    const firstItem = epcList[0];
    if (!firstItem?.id) return {};

    return {
      primaryIdentifier: firstItem.id,
      product: { registeredId: firstItem.id },
    };
  }
}
