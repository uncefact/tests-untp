import { ErrorObject } from 'ajv';
import {
  IValidatedCredentials,
  TemplateName,
  FinalStatus,
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
  const isWarningType = errors.find((error) => error?.params?.additionalProperty);
  if (isWarningType) {
    // If any ErrorObject has 'additionalProperty', return 'warning'
    return TemplateName.warn;
  }

  // If no ErrorObject has 'additionalProperty', return 'FAIL'
  return TemplateName.error;
};

export const generateFinalMessage = (credentials: ICredentialTestResult[]): IFinalReport => {
  const initFinalReport = { finalStatus: FinalStatus.pass, finalMessage: TestSuiteMessage.Pass } as IFinalReport;

  return credentials.reduce((acc, credential) => {
    if (credential.result === FinalStatus.warn && acc.finalStatus !== FinalStatus.fail) {
      acc.finalMessage = TestSuiteMessage.Warning;
      acc.finalStatus = FinalStatus.warn;
    }

    if (credential.result === FinalStatus.fail) {
      acc.finalMessage = TestSuiteMessage.Fail;
      acc.finalStatus = FinalStatus.fail;
    }

    return acc;
  }, initFinalReport);
};
