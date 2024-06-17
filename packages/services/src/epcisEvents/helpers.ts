import { getLinkResolverIdentifier } from '../linkResolver.service.js';
import { randomIntegerString } from '../utils/helpers.js';

export const generateLinkResolver = (dlrUrl: string, identificationKeyType: string, queryString: string) => {
  const _generateLinkResolver = (currentData: string, id: string) => {
    const { identifier, qualifierPath } = getLinkResolverIdentifier(id);
    const path = qualifierPath.includes('?') ? `${qualifierPath}&${queryString}` : `${qualifierPath}?${queryString}`;
    return `${dlrUrl}/${identificationKeyType}/${identifier}${path}`;
  };
  return _generateLinkResolver;
};

export const generateIdWithSerialNumber = (currentData: string) => {
  if (!currentData) {
    return null;
  }
  return `${currentData}21${randomIntegerString(9)}`;
};

export const generateIdWithBatchLot = (currentData: string) => {
  if (!currentData) {
    return null;
  }
  return `${currentData}10${randomIntegerString(9)}`;
};
