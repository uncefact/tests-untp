import type { DataModelConfig } from '../types.js';

export function buildContextAndTypes(config: DataModelConfig): {
  contexts: string[];
  types: string[];
} {
  const contexts: string[] = [config.core.contextUrl];
  const types: string[] = [config.core.credentialType];

  if (config.extension) {
    contexts.push(config.extension.contextUrl);
    if (config.extension.credentialType !== config.core.credentialType) {
      types.push(config.extension.credentialType);
    }
  }

  return { contexts, types };
}
