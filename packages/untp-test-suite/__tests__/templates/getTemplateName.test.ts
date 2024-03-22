import { getTemplateName } from '../../src/templates/getTemplateName';

describe('getTemplateName', () => {
  it('should return "pass" when there are no errors', () => {
    const testSuiteResult = {
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '',
      errors: [],
    };

    const result = getTemplateName(testSuiteResult);

    expect(result).toEqual('pass');
  });

  it('should return "FAIL" when there are errors', () => {
    const testSuiteResult = {
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '',
      errors: [
        {
          message: 'should have required property',
          keyword: 'required',
          dataPath: 'path/to/credentials',
          instancePath: 'type',
        },
      ],
    };

    const result = getTemplateName(testSuiteResult);

    expect(result).toEqual('error');
  });

  it('should return "warn" when there are errors with additional properties', () => {
    const testSuiteResult = {
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '',
      errors: [
        {
          message: 'should NOT have additional properties',
          keyword: 'additionalProperties',
          dataPath: 'path/to/credentials',
          instancePath: 'type',
          params: {
            additionalProperty: 'additionalProperty',
          },
        },
      ],
    };

    const result = getTemplateName(testSuiteResult);

    expect(result).toEqual('warning');
  });

  it('should return "pass" when there are errors without additional properties', () => {
    const testSuiteResult = {
      type: 'aggregationEvent',
      version: 'v0.0.1',
      dataPath: '',
      errors: [],
    };

    const result = getTemplateName(testSuiteResult);

    expect(result).toEqual('pass');
  });
});
