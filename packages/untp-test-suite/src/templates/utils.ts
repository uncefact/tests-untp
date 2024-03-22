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
  if (testSuiteResult.errors === null) {
    return TemplateName.pass;
  }

  if (Array.isArray(testSuiteResult.errors) && testSuiteResult.errors.length > 0) {
    const errorObjects = testSuiteResult.errors as ErrorObject[];
    const errorWithAdditionalProperty = errorObjects.find((error) => error?.params?.additionalProperty);
    if (errorWithAdditionalProperty) {
      // If any ErrorObject has 'additionalProperty', return 'warning'
      return TemplateName.warn;
    }

    // If no ErrorObject has 'additionalProperty', return 'FAIL'
    return TemplateName.error;
  } else {
    return TemplateName.pass;
  }
};

export const generateFinalMessage = (credentials: ICredentialTestResult[]): IFinalReport => {
  let finalMessage = TestSuiteMessage.Pass;
  let finalStatus: FinalStatus = FinalStatus.pass;

  if (credentials.some((credential) => credential.result === FinalStatus.warn)) {
    finalMessage = TestSuiteMessage.Warning;
    finalStatus = FinalStatus.warn;
  }

  if (credentials.some((credential) => credential.result === FinalStatus.fail)) {
    finalMessage = TestSuiteMessage.Fail;
    finalStatus = FinalStatus.fail;
  }

  return {
    finalStatus,
    finalMessage,
  };
};
