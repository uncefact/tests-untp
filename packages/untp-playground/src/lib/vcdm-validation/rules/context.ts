import { CombinedValidationRule } from '@/types';
import { VCDM_CONTEXT_URLS } from '../../../../constants';

const allowedVcdmVersions = Object.values(VCDM_CONTEXT_URLS);

const requiredContextRule: CombinedValidationRule = {
  predicate: (value) => typeof value !== 'undefined',
  keyword: 'required',
  instancePath: '@context',
  message: 'The "@context" property is required.',
  params: { missingProperty: '@context' },
};

const arrayTypeRule: CombinedValidationRule = {
  predicate: (value) => Array.isArray(value),
  keyword: 'type',
  instancePath: '@context',
  message: 'The "@context" property must be an array.',
  params: { type: 'array' },
};

const minItemsRule: CombinedValidationRule = {
  predicate: (value) => Array.isArray(value) && value.length > 0,
  keyword: 'minItems',
  instancePath: '@context',
  message: 'The "@context" array must contain at least one item.',
  params: { minItems: 1 },
};

const allowedVersionRule: CombinedValidationRule = {
  predicate: (value) => Array.isArray(value) && value.length > 0 && allowedVcdmVersions.includes(value[0]),
  keyword: 'missingValue',
  instancePath: '@context[0]',
  message: `The first element of "@context" must be one of the following:`,
  params: { allowedValues: allowedVcdmVersions },
};

export const vcdmContextRules: CombinedValidationRule[] = [
  requiredContextRule,
  arrayTypeRule,
  minItemsRule,
  allowedVersionRule,
];
