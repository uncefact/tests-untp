import JSONPointer from 'jsonpointer';
import _ from 'lodash';
export type Identifier = {
  applicationIdentifiers: {
    shortcode: string;
    ai: string;
    type: string;
    regex: string;
    qualifiers: string[];
  };
};

type AIData = {
  primary: {
    ai: string;
    value: string;
  };
  qualifiers: { ai: string; value: string }[];
};

type AIPathConfigures = {
  primary: {
    ai: string;
    path: string;
  };
  qualifiers: {
    ai: string;
    path: string;
  }[];
};

export const constructIdentifierData = (identifierKeyPath: string | AIPathConfigures, data: any): AIData => {
  if (_.isString(identifierKeyPath)) {
    const identifyData = JSONPointer.get(data, identifierKeyPath);
    return parseLinkResolverURLToAIs(identifyData);
  }
  if (_.isObject(identifierKeyPath)) {
    return constructAIData(data, identifierKeyPath);
  }

  throw new Error('Invalid identifierKeyPath');
};

export const constructElementString = (aiData: AIData): string => {
  if (!aiData.primary.ai || !aiData.primary.value) {
    throw new Error('Primary AI or value not found');
  }
  const qualifiersString = aiData.qualifiers
    ? aiData.qualifiers.map((qualifier) => `(${qualifier.ai})${qualifier.value}`).join('')
    : '';
  return `(${aiData.primary.ai})${aiData.primary.value}${qualifiersString}`;
};

export const constructQualifierPath = (qualifiers: { ai: string; value: string }[]): string => {
  if (!qualifiers) return '/';
  return qualifiers.map((qualifier) => `/${qualifier.ai}/${qualifier.value}`).join('') || '/';
};

const parseLinkResolverURLToAIs = (url: string): AIData => {
  const regex = /\/(\d{2}|\d{3})\/([^/]+)/g;
  const matches = [...url.matchAll(regex)];

  if (!matches.length) {
    throw new Error('No AI-value pairs found in the URL.');
  }

  const primary = { ai: matches[0][1], value: matches[0][2] };
  const qualifiers = matches.slice(1).map((match) => ({ ai: match[1], value: match[2] }));

  return { primary, qualifiers };
};

const constructAIData = (data: any, keyPath: AIPathConfigures) => {
  const primary = { ai: keyPath.primary.ai, value: JSONPointer.get(data, keyPath.primary.path) };
  const qualifiers = keyPath.qualifiers
    ? keyPath.qualifiers.map((qualifier) => ({
        ai: qualifier.ai,
        value: JSONPointer.get(data, qualifier.path),
      }))
    : [];
  return { primary, qualifiers };
};
