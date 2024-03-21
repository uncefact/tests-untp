import { generateFinalMessage } from '../../src/templates/generateFinalMessage';

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
