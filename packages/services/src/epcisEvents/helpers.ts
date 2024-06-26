import JSONPointer from 'jsonpointer';
import { deleteValuesFromLocalStorage } from '../features/localStorage.service.js';
import { buildElementString, extractFromElementString, getLinkResolverIdentifier } from '../linkResolver.service.js';
import { ICurrentAndDependencies, allowedIndexKeys, randomIntegerString } from '../utils/helpers.js';

export const generateLinkResolver = (dlrUrl: string, identificationKeyType: string, queryString: string) => {
  const _generateLinkResolver = ({ currentData, dependenciesValues }: ICurrentAndDependencies) => {
    const { identifier, qualifierPath } = getLinkResolverIdentifier(dependenciesValues![0]);
    const path = qualifierPath.includes('?') ? `${qualifierPath}&${queryString}` : `${qualifierPath}?${queryString}`;
    return `${dlrUrl}/${identificationKeyType}/${identifier}${path}`;
  };
  return _generateLinkResolver;
};

export const generateIdWithSerialNumber = ({ currentData, dependenciesValues }: ICurrentAndDependencies) => {
  if (!currentData) {
    return null;
  }

  const aiArray = extractFromElementString(currentData);
  aiArray['21'] = randomIntegerString(9);

  return buildElementString(aiArray);
};

export const generateIdWithBatchLot = ({ currentData, dependenciesValues }: ICurrentAndDependencies) => {
  if (!currentData) {
    return null;
  }
  const aiArray = extractFromElementString(currentData);
  aiArray['10'] = randomIntegerString(9);

  return buildElementString(aiArray);
};

export const deleteValuesFromLocalStorageByKeyPath = (storageKey: string, data: any, keyPath: string) => {
  const index = keyPath.split('/').findIndex((key) => allowedIndexKeys.includes(key));
  if (index === -1) {
    const key = JSONPointer.get(data, keyPath);
    deleteValuesFromLocalStorage({ storageKey, keys: [key] });
  } else {
    const headPath = keyPath.split('/').slice(0, index).join('/');
    const tailPath = keyPath
      .split('/')
      .slice(index + 1)
      .join('/');
    const array = JSONPointer.get(data, headPath);
    const keys = array.map((item: any) => JSONPointer.get(item, `/${tailPath}`));
    deleteValuesFromLocalStorage({ storageKey, keys });
  }
};
