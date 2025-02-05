import { validateWithRules } from '@/lib/validationHelpers';
import { CombinedValidationRule, ValidationError } from '@/types';

describe('validateWithRules', () => {
  const testValue = {
    name: 'John Doe',
    age: 25,
  };

  it('should return empty array when all sync rules pass', async () => {
    const rules: CombinedValidationRule<typeof testValue>[] = [
      {
        keyword: 'test',
        instancePath: '/name',
        message: 'Name should be a string',
        predicate: (value) => typeof value.name === 'string',
        params: {},
      },
      {
        keyword: 'test',
        instancePath: '/age',
        message: 'Age should be a number',
        predicate: (value) => typeof value.age === 'number',
        params: {},
      },
    ];

    const errors = await validateWithRules(testValue, rules);
    expect(errors).toEqual([]);
  });

  it('should return validation errors when sync rules fail', async () => {
    const rules: CombinedValidationRule<typeof testValue>[] = [
      {
        keyword: 'test',
        instancePath: '/age',
        message: 'Age should be over 30',
        predicate: (value) => value.age > 30,
        params: { minimum: 30 },
      },
    ];

    const expectedError: ValidationError = {
      keyword: 'test',
      instancePath: '/age',
      message: 'Age should be over 30',
      params: { minimum: 30 },
    };

    const errors = await validateWithRules(testValue, rules);
    expect(errors).toEqual([expectedError]);
  });

  it('should handle async validation rules that pass', async () => {
    const rules: CombinedValidationRule<typeof testValue>[] = [
      {
        keyword: 'test',
        instancePath: '/name',
        message: 'Name should be valid',
        predicate: async (value) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return value.name.length > 0;
        },
        params: {},
      },
    ];

    const errors = await validateWithRules(testValue, rules);
    expect(errors).toEqual([]);
  });

  it('should handle async validation rules that fail', async () => {
    const rules: CombinedValidationRule<typeof testValue>[] = [
      {
        keyword: 'test',
        instancePath: '/name',
        message: 'Name should be longer than 10 characters',
        predicate: async (value) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return value.name.length > 10;
        },
        params: { minLength: 10 },
      },
    ];

    const expectedError: ValidationError = {
      keyword: 'test',
      instancePath: '/name',
      message: 'Name should be longer than 10 characters',
      params: { minLength: 10 },
    };

    const errors = await validateWithRules(testValue, rules);
    expect(errors).toEqual([expectedError]);
  });

  it('should handle mixed sync and async rules', async () => {
    const rules: CombinedValidationRule<typeof testValue>[] = [
      {
        keyword: 'test',
        instancePath: '/age',
        message: 'Age should be over 30',
        predicate: (value) => value.age > 30,
        params: { minimum: 30 },
      },
      {
        keyword: 'test',
        instancePath: '/name',
        message: 'Name should be longer than 10 characters',
        predicate: async (value) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return value.name.length > 10;
        },
        params: { minLength: 10 },
      },
    ];

    const expectedErrors: ValidationError[] = [
      {
        keyword: 'test',
        instancePath: '/age',
        message: 'Age should be over 30',
        params: { minimum: 30 },
      },
      {
        keyword: 'test',
        instancePath: '/name',
        message: 'Name should be longer than 10 characters',
        params: { minLength: 10 },
      },
    ];

    const errors = await validateWithRules(testValue, rules);
    expect(errors).toEqual(expectedErrors);
  });

  it('should handle empty rules array', async () => {
    const errors = await validateWithRules(testValue, []);
    expect(errors).toEqual([]);
  });
});
