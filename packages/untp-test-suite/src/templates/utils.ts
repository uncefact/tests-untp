import { ErrorObject } from 'ajv';
import {
  IValidatedCredentials,
  TemplateName,
  TestSuiteResultEnum,
  ICredentialTestResult,
  IFinalReport,
  TestSuiteMessage,
} from '../core/types/index.js';

export const getTemplateName = (testSuiteResult: IValidatedCredentials): string => {
  // If there are no errors, return 'pass'
  if (!testSuiteResult.errors || !testSuiteResult.errors.length) {
    return TemplateName.pass;
  }

  const errors = testSuiteResult.errors as ErrorObject[];
  const isWarningType = errors.every((error) => error?.params?.additionalProperty);
  if (isWarningType) {
    // If any ErrorObject has 'additionalProperty', return 'warning'
    return TemplateName.warn;
  }

  // If no ErrorObject has 'additionalProperty', return 'FAIL'
  return TemplateName.error;
};

export const generateFinalMessage = (credentials: ICredentialTestResult[]): IFinalReport => {
  const initFinalReport = { finalStatus: TestSuiteResultEnum.PASS, finalMessage: TestSuiteMessage.Pass } as IFinalReport;

  return credentials.reduce((acc, credential) => {
    if (credential.result === TestSuiteResultEnum.WARN && acc.finalStatus !== TestSuiteResultEnum.FAIL) {
      acc.finalMessage = TestSuiteMessage.Warning;
      acc.finalStatus = TestSuiteResultEnum.WARN;
    }

    if (credential.result === TestSuiteResultEnum.FAIL) {
      acc.finalMessage = TestSuiteMessage.Fail;
      acc.finalStatus = TestSuiteResultEnum.FAIL;
    }

    return acc;
  }, initFinalReport);
};

export const getMapperValueByTemplate = (templateName: string, testSuiteResult: IValidatedCredentials) => {
  if (templateName === TemplateName.pass) {
    return testSuiteResult;
  }

  const errors = testSuiteResult.errors as ErrorObject[];
  if (templateName === TemplateName.warn) {
    return {
      ...testSuiteResult,
      warnings: errors
    };
  }

  const { mapperErrors, mapperWarnings } = errors.reduce((result: { mapperErrors: ErrorObject[], mapperWarnings: ErrorObject[] }, current) => {
    if (current.params?.additionalProperty) {
      result.mapperWarnings.push(current);
    } else {
      result.mapperErrors.push(current);
    }

    return result;
  }, { mapperErrors: [], mapperWarnings: [] });

  return {
    ...testSuiteResult,
    errors: mapperErrors,
    warnings: mapperWarnings
  }
}