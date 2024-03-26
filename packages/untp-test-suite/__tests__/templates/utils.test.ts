import { IFinalReport, IValidatedCredentials, TemplateEnum, TestSuiteResultEnum } from '../../src/core/types';
import * as mapperUtils from '../../src/templates/mapper';
import * as templateUtils from '../../src/templates/utils';

jest.mock('path', () => ({
  join: jest.fn(),
}));

jest.mock('path', () => ({
  join: jest.fn(),
}));

jest.mock('../../src/utils/path', () => ({
  getCurrentFilePath: jest.fn(() => 'test/data/file.ts'),
  getCurrentDirPath: jest.fn(),
}));

const passCredential = {
  type: 'productPassport',
  version: 'v0.0.1',
  dataPath: 'data/productPassport.json',
  errors: [],
};

const warningCredential = {
  type: 'productPassport',
  version: 'v0.0.1',
  dataPath: 'data/productPassport.json',
  errors: [
    {
      keyword: 'required',
      instancePath: 'type',
      schemaPath: '/',
      params: { additionalProperty: 'testField' },
    },
  ],
};

const errorCredential = {
  type: 'productPassport',
  version: 'v0.0.1',
  dataPath: 'data/productPassport.json',
  errors: [
    {
      keyword: 'required',
      instancePath: 'type',
      schemaPath: '/',
      params: {},
    },
  ],
};

const errorAndWarningCredential = {
  type: 'productPassport',
  version: 'v0.0.1',
  dataPath: 'data/productPassport.json',
  errors: [
    {
      keyword: 'required',
      instancePath: 'type',
      schemaPath: '/',
      params: { additionalProperty: 'testField' },
    },
    {
      keyword: 'enum',
      instancePath: 'type',
      schemaPath: '/',
      params: {},
    },
  ],
};

const validatedCredentials = [passCredential, warningCredential, errorCredential, errorAndWarningCredential];

describe('getValidationTemplateData', () => {
  it('should return pass template when no errors are present', () => {
    const result = templateUtils.getValidationTemplateData(passCredential);

    expect(result).toEqual({
      ...passCredential,
      result: TestSuiteResultEnum.PASS,
      subTemplates: [],
    });
  });

  it('should return warning template when all errors have additional properties', () => {
    const result = templateUtils.getValidationTemplateData(warningCredential);

    expect(result).toEqual({
      ...warningCredential,
      result: TestSuiteResultEnum.WARN,
      validationWarnings: warningCredential.errors,
      subTemplates: [TemplateEnum.VALIDATION_WARNINGS],
    });
  });

  it('should return error template when at least one error does not have additional properties', () => {
    const result = templateUtils.getValidationTemplateData(errorCredential);

    expect(result).toEqual({
      ...errorCredential,
      result: TestSuiteResultEnum.FAIL,
      validationErrors: errorCredential.errors,
      validationWarnings: [],
      subTemplates: [TemplateEnum.VALIDATION_ERRORS],
    });
  });

  it('should return error and warning templates when there are both error and warning errors', () => {
    const result = templateUtils.getValidationTemplateData(errorAndWarningCredential);

    expect(result).toEqual({
      ...errorAndWarningCredential,
      result: TestSuiteResultEnum.FAIL,
      validationErrors: [
        {
          keyword: 'enum',
          instancePath: 'type',
          schemaPath: '/',
          params: {},
        },
      ],
      validationWarnings: [
        {
          keyword: 'required',
          instancePath: 'type',
          schemaPath: '/',
          params: { additionalProperty: 'testField' },
        },
      ],
      subTemplates: [TemplateEnum.VALIDATION_ERRORS, TemplateEnum.VALIDATION_WARNINGS],
    });
  });
});

describe('getCredentialResults', () => {
  it('should return an array of credential test results', async () => {
    jest.spyOn(mapperUtils, 'templateMapper').mockImplementation((_: string, testSuiteResult: IValidatedCredentials | IFinalReport) => Promise.resolve(JSON.stringify(testSuiteResult)));

    const credentialResults = await templateUtils.getCredentialResults(validatedCredentials);

    expect(credentialResults).toEqual([
      {
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        errors: [],
        result: 'PASS',
      },
      {
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        errors: [
          {
            keyword: 'required',
            instancePath: 'type',
            schemaPath: '/',
            params: {
              additionalProperty: 'testField',
            },
          },
        ],
        result: 'WARN',
        validationWarnings: [
          {
            keyword: 'required',
            instancePath: 'type',
            schemaPath: '/',
            params: {
              additionalProperty: 'testField',
            },
          },
        ],
      },
      {
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        errors: [
          {
            keyword: 'required',
            instancePath: 'type',
            schemaPath: '/',
            params: {},
          },
        ],
        result: 'FAIL',
        validationErrors: [
          {
            keyword: 'required',
            instancePath: 'type',
            schemaPath: '/',
            params: {},
          },
        ],
        validationWarnings: [],
      },
      {
        type: 'productPassport',
        version: 'v0.0.1',
        dataPath: 'data/productPassport.json',
        errors: [
          {
            keyword: 'required',
            instancePath: 'type',
            schemaPath: '/',
            params: {
              additionalProperty: 'testField',
            },
          },
          {
            keyword: 'enum',
            instancePath: 'type',
            schemaPath: '/',
            params: {},
          },
        ],
        result: 'FAIL',
        validationErrors: [
          {
            keyword: 'enum',
            instancePath: 'type',
            schemaPath: '/',
            params: {},
          },
        ],
        validationWarnings: [
          {
            keyword: 'required',
            instancePath: 'type',
            schemaPath: '/',
            params: {
              additionalProperty: 'testField',
            },
          },
        ],
      },
    ]);
  });

  it('should correctly map validated credentials to credential test results with pass template', async () => {
    jest.spyOn(mapperUtils, 'templateMapper').mockImplementation((_: string, testSuiteResult: IValidatedCredentials | IFinalReport) => Promise.resolve(JSON.stringify(testSuiteResult)));

    const credentialResults = await templateUtils.getCredentialResults([passCredential]);

    expect(credentialResults).toEqual([{
      type: 'productPassport',
      version: 'v0.0.1',
      dataPath: 'data/productPassport.json',
      errors: [],
      result: 'PASS',
    }]);
  });

  it('should correctly map validated credentials to credential test results with warning template', async () => {
    jest.spyOn(mapperUtils, 'templateMapper').mockImplementation((_: string, testSuiteResult: IValidatedCredentials | IFinalReport) => Promise.resolve(JSON.stringify(testSuiteResult)));

    const credentialResults = await templateUtils.getCredentialResults([warningCredential]);

    expect(credentialResults).toEqual([{
      type: 'productPassport',
      version: 'v0.0.1',
      dataPath: 'data/productPassport.json',
      errors: [
        {
          keyword: 'required',
          instancePath: 'type',
          schemaPath: '/',
          params: {
            additionalProperty: 'testField',
          },
        },
      ],
      result: 'WARN',
      validationWarnings: [
        {
          keyword: 'required',
          instancePath: 'type',
          schemaPath: '/',
          params: {
            additionalProperty: 'testField',
          },
        },
      ],
    }]);
  });

  it('should correctly map validated credentials to credential test results with error template', async () => {
    jest.spyOn(mapperUtils, 'templateMapper').mockImplementation((_: string, testSuiteResult: IValidatedCredentials | IFinalReport) => Promise.resolve(JSON.stringify(testSuiteResult)));

    const credentialResults = await templateUtils.getCredentialResults([errorCredential]);

    expect(credentialResults).toEqual([{
      type: 'productPassport',
      version: 'v0.0.1',
      dataPath: 'data/productPassport.json',
      errors: [{
        keyword: 'required',
        instancePath: 'type',
        schemaPath: '/',
        params: {},
      }],
      result: 'FAIL',
      validationErrors: [
        {
          keyword: 'required',
          instancePath: 'type',
          schemaPath: '/',
          params: {},
        },
      ],
      validationWarnings: [],
    }]);
  });

  it('should correctly map validated credentials to credential test results with error and warning templates', async () => {
    jest.spyOn(mapperUtils, 'templateMapper').mockImplementation((_: string, testSuiteResult: IValidatedCredentials | IFinalReport) => Promise.resolve(JSON.stringify(testSuiteResult)));

    const credentialResults = await templateUtils.getCredentialResults([errorAndWarningCredential]);

    expect(credentialResults).toEqual([{
      type: 'productPassport',
      version: 'v0.0.1',
      dataPath: 'data/productPassport.json',
      errors: [
        {
          keyword: 'required',
          instancePath: 'type',
          schemaPath: '/',
          params: {
            additionalProperty: 'testField',
          },
        },
        {
          keyword: 'enum',
          instancePath: 'type',
          schemaPath: '/',
          params: {},
        },
      ],
      result: 'FAIL',
      validationErrors: [
        {
          keyword: 'enum',
          instancePath: 'type',
          schemaPath: '/',
          params: {},
        },
      ],
      validationWarnings: [
        {
          keyword: 'required',
          instancePath: 'type',
          schemaPath: '/',
          params: {
            additionalProperty: 'testField',
          },
        },
      ],
    }]);
  });

});

  describe('getFinalReport', () => {
    it('should return a final report with PASS status when all credentials pass', async () => {
      jest.spyOn(mapperUtils, 'templateMapper').mockImplementation((_: string, testSuiteResult: IValidatedCredentials | IFinalReport) => Promise.resolve(JSON.stringify(testSuiteResult)));
      const passCredentialResult = {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.PASS,
      };

      const credentialResults = await templateUtils.getFinalReport([passCredentialResult, passCredentialResult]);

      expect(credentialResults).toEqual({
        finalStatus: 'PASS',
        finalMessage: 'Your credentials are UNTP compliant'
      });
    });

    it('should return a final report with WARNING status when at least one credential warns', async () => {
      jest.spyOn(mapperUtils, 'templateMapper').mockImplementation((_: string, testSuiteResult: IValidatedCredentials | IFinalReport) => Promise.resolve(JSON.stringify(testSuiteResult)));
      const warningCredentialResult = {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.WARN,
        validationWarnings: [{
          fieldName: 'additionalFieldTest',
          message: 'This schema must NOT have additional properties',
        }],
      };

      const credentialResults = await templateUtils.getFinalReport([warningCredentialResult]);

      expect(credentialResults).toEqual({
        finalStatus: 'WARN',
        finalMessage: 'Your credentials are UNTP compliant, but have extended the data model'
      });
    });
  
    it('should return a final report with FAIL status when at least one credential fails', async () => {
      jest.spyOn(mapperUtils, 'templateMapper').mockImplementation((_: string, testSuiteResult: IValidatedCredentials | IFinalReport) => Promise.resolve(JSON.stringify(testSuiteResult)));
      const errorCredentialResult = {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.FAIL,
        validationErrors: [
          {
            fieldName: '/eventType',
            errorType: 'enum',
            allowedValues: ['object', 'transaction', 'aggregation', 'transformation'],
            message: '/eventType field must be equal to one of the allowed values',
          },
        ],
        validationWarnings: [],
      };

      const credentialResults = await templateUtils.getFinalReport([errorCredentialResult]);

      expect(credentialResults).toEqual({
        finalStatus: 'FAIL',
        finalMessage: 'Your credentials are not UNTP compliant'
      });
    });
  
    it('should prioritize FAIL status over WARNING status when both are present', async () => {
      jest.spyOn(mapperUtils, 'templateMapper').mockImplementation((_: string, testSuiteResult: IValidatedCredentials | IFinalReport) => Promise.resolve(JSON.stringify(testSuiteResult)));
      const errorAndWarningCredentialResult = {
        credentialType: 'productPassport',
        version: 'v0.0.1',
        path: 'data/productPassport.json',
        result: TestSuiteResultEnum.FAIL,
        validationErrors: [
          {
            fieldName: '/eventType',
            errorType: 'enum',
            allowedValues: ['object', 'transaction', 'aggregation', 'transformation'],
            message: '/eventType field must be equal to one of the allowed values',
          },
        ],
        validationWarnings: [{
          fieldName: 'additionalFieldTest',
          message: 'must NOT have additional properties',
        }],
      };

      const credentialResults = await templateUtils.getFinalReport([errorAndWarningCredentialResult]);

      expect(credentialResults).toEqual({
        finalStatus: 'FAIL',
        finalMessage: 'Your credentials are not UNTP compliant'
      });
    });
  });
