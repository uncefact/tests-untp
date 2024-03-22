import { generateFinalMessage, getTemplateName } from '../../src/templates/utils';

describe('generateFinalMessage', () => {
  it('should return FAIL when mix the Failed, Passed and Warning results', () => {
    const credentials = [
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'PASS',
      },
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'FAIL',
      },
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'WARN',
      },
    ];

    const result = generateFinalMessage(credentials);

    expect(result).toEqual({
      finalStatus: 'FAIL',
      finalMessage: 'Your credentials are not UNTP compliant',
    });
  });

  it('should return WARN when mix the Passed and Warning results', () => {
    const credentials = [
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'PASS',
      },
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'WARN',
      },
    ];

    const result = generateFinalMessage(credentials);

    expect(result).toEqual({
      finalStatus: 'WARN',
      finalMessage: 'Your credentials are UNTP compliant, but have extended the data model',
    });
  });

  it('should return PASS when all results are Passed', () => {
    const credentials = [
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'PASS',
      },
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'PASS',
      },
    ];

    const result = generateFinalMessage(credentials);

    expect(result).toEqual({
      finalStatus: 'PASS',
      finalMessage: 'Your credentials are UNTP compliant',
    });
  });

  it('should return WARN when all results are Warning', () => {
    const credentials = [
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'WARN',
      },
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'WARN',
      },
    ];

    const result = generateFinalMessage(credentials);

    expect(result).toEqual({
      finalStatus: 'WARN',
      finalMessage: 'Your credentials are UNTP compliant, but have extended the data model',
    });
  });

  it('should return FAIL when all results are Failed', () => {
    const credentials = [
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'FAIL',
      },
      {
        credentialType: 'aggregationEvent',
        version: 'v0.0.1',
        path: '',
        result: 'FAIL',
      },
    ];

    const result = generateFinalMessage(credentials);

    expect(result).toEqual({
      finalStatus: 'FAIL',
      finalMessage: 'Your credentials are not UNTP compliant',
    });
  });
});

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
