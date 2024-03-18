import fs from 'fs/promises';
import { templateMapper } from '../../src/templates/mapper';
import path from 'path';

jest.mock('../../src/utils/path', () => ({
  getCurrentFilePath: jest.fn(),
  getCurrentDirPath: jest.fn(),
}));

jest.mock('path', () => ({
  join: jest.fn(),
}));

describe('templateMapper', () => {
  const errorTemplate = `{
    "testingCredential": "{{type}} {{version}}",
    "path": "{{dataPath}}",
    "result": "FAIL",
    "errors": [
      {{#each errors}}
      {
        "fieldName": "{{instancePath}}",
        "errorType": "{{keyword}}",
          {{#if params.allowedValues}}
        "allowedValues": {{{jsonStringify params.allowedValues}}},
          {{/if}}
        "message": "{{instancePath}} field {{message}}"
      }
      {{#unless @last}},{{/unless}}
      {{/each}}
    ]
  }`;

  const passTemplate = `{
    "testingCredential": "{{type}} {{version}}",
    "path": "{{dataPath}}",
    "result": "PASS"
  }`;

  const warningTemplate = `{
    "testingCredential": "{{type}} {{version}}",
    "path": "{{dataPath}}",
    "result": "WARN",
    "warnings": [
      {{#each warnings}}
        {
          "fieldName": "{{params.additionalProperty}}",
          "message": "This schema {{message}}"
        }
        {{#unless @last}},{{/unless}}
      {{/each}}
    ]
  }`;

  const finalReportTemplate = `{
    "finalStatus": "{{finalStatus}}",
    "finalMessage": "{{finalMessage}}"
  }`;

  const errorItem = {
    instancePath: '/eventType',
    schemaPath: '#/properties/eventType/enum',
    keyword: 'enum',
    params: { allowedValues: ['object', 'transaction', 'aggregation', 'transformation'] },
    message: 'must be equal to one of the allowed values',
  };
  const testSuiteResult = {
    type: 'testEvent',
    version: 'v0.0.1',
    dataPath: 'test/data/path.json',
    errors: [errorItem],
  };

  it('should map the error template correctly', async () => {
    jest.spyOn(path, 'join').mockReturnValueOnce('../../src/templates/templateMessages/error.hbs');
    jest.spyOn(fs, 'readFile').mockResolvedValue(errorTemplate);

    const mappedJsonString = await templateMapper('error', testSuiteResult);

    expect(mappedJsonString).toEqual(
      `{
    "testingCredential": "testEvent v0.0.1",
    "path": "test/data/path.json",
    "result": "FAIL",
    "errors": [
      {
        "fieldName": "/eventType",
        "errorType": "enum",
        "allowedValues": ["object","transaction","aggregation","transformation"],
        "message": "/eventType field must be equal to one of the allowed values"
      }
      
    ]
  }`,
    );
  });

  it('should map the pass template correctly', async () => {
    jest.spyOn(path, 'join').mockReturnValueOnce('../../src/templates/templateMessages/pass.hbs');
    jest.spyOn(fs, 'readFile').mockResolvedValue(passTemplate);

    const mappedJsonString = await templateMapper('pass', testSuiteResult);

    expect(mappedJsonString).toEqual(
      `{
    "testingCredential": "testEvent v0.0.1",
    "path": "test/data/path.json",
    "result": "PASS"
  }`,
    );
  });

  it('should map the warning template correctly', async () => {
    jest.spyOn(path, 'join').mockReturnValueOnce('../../src/templates/templateMessages/warning.hbs');
    jest.spyOn(fs, 'readFile').mockResolvedValue(warningTemplate);
    const warningTestSuiteResult = {
      ...testSuiteResult,
      warnings: [
        {
          instancePath: '',
          schemaPath: '#/additionalProperties',
          keyword: 'additionalProperties',
          params: {
            additionalProperty: 'additionalField',
          },
          message: 'must NOT have additional properties',
        },
      ],
    };

    const mappedJsonString = await templateMapper('warning', warningTestSuiteResult);

    expect(mappedJsonString).toEqual(
      `{
    "testingCredential": "testEvent v0.0.1",
    "path": "test/data/path.json",
    "result": "WARN",
    "warnings": [
        {
          "fieldName": "additionalField",
          "message": "This schema must NOT have additional properties"
        }
        
    ]
  }`,
    );
  });

  it('should map the final report template correctly', async () => {
    jest.spyOn(path, 'join').mockReturnValueOnce('../../src/templates/templateMessages/finalReport.hbs');
    jest.spyOn(fs, 'readFile').mockResolvedValue(finalReportTemplate);
    const finalReportTestSuiteResult = {
      ...testSuiteResult,
      finalStatus: 'PASS',
      finalMessage: 'Your credentials are UNTP compliant 🎉'
    }

    const mappedJsonString = await templateMapper('finalReport', finalReportTestSuiteResult);

    expect(mappedJsonString).toEqual(`{
    "finalStatus": "PASS",
    "finalMessage": "Your credentials are UNTP compliant 🎉"
  }`);
  });

  it('should throw an error if template file is not found', async () => {
    jest.spyOn(fs, 'readFile').mockRejectedValueOnce(new Error('File not found'));

    try {
      await templateMapper('nonExistentTemplate', testSuiteResult);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Failed to run mapper template. File not found');
    }
  });

  it('should throw an error when provided an invalid allowedValues', async () => {
    const emptyAllowedValues = {
      ...testSuiteResult,
      errors: [
        {
          ...errorItem,
          params: { allowedValues: 1 },
        },
      ],
    };

    try {
      await templateMapper('nonExistentTemplate', emptyAllowedValues);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe(
        `Failed to run mapper template. An error occurred in the Handlebars registerHelper 'jsonStringify' function. Please provide a valid JSON object.`,
      );
    }
  });
});
