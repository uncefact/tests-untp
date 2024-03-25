import { ErrorObject } from 'ajv';
import {
  IValidatedCredentials,
  TestSuiteResultEnum,
  ICredentialTestResult,
  IFinalReport,
  TestSuiteMessage,
  IValidationTemplateData,
  TemplateEnum,
} from '../core/types/index.js';
import { templateMapper } from './mapper.js';

export const getValidationTemplateData = (validatedCredential: IValidatedCredentials): IValidationTemplateData => {
  const errors = validatedCredential.errors as ErrorObject[];

  // Pass template
  const isPassTemplate = !errors?.length;
  if (isPassTemplate) {
    return {
      ...validatedCredential,
      result: TestSuiteResultEnum.PASS,
      subTemplates: []
    };
  }

  // Warning template
  const isWarningTemplate = errors.every((error) => error?.params?.additionalProperty);
  if (isWarningTemplate) {
    return {
      ...validatedCredential,
      result: TestSuiteResultEnum.WARN,
      validationWarnings: errors,
      subTemplates: [TemplateEnum.VALIDATION_WARNINGS],
    };
  }
  
  // Error or Error and warning template
  const { validationErrors, validationWarnings } = errors.reduce((validationResult, current) => {
    const key = current.params?.additionalProperty ? TemplateEnum.VALIDATION_WARNINGS : TemplateEnum.VALIDATION_ERRORS;
    validationResult[key].push(current);

    return validationResult;
  }, {
    [TemplateEnum.VALIDATION_ERRORS]: [] as ErrorObject[],
    [TemplateEnum.VALIDATION_WARNINGS]: [] as ErrorObject[]
  });

  return {
    ...validatedCredential,
    result: TestSuiteResultEnum.FAIL,
    validationErrors,
    validationWarnings,
    subTemplates: validationWarnings.length ? [TemplateEnum.VALIDATION_ERRORS, TemplateEnum.VALIDATION_WARNINGS] : [TemplateEnum.VALIDATION_ERRORS],
  };
};

export const getCredentialResults = async (validatedCredentials: IValidatedCredentials[]): Promise<ICredentialTestResult[]> => {
  const credentialsResultPromises = validatedCredentials.map(async (validatedCredential) => {
    const { subTemplates, ...templateData } = getValidationTemplateData(validatedCredential);

    const credentialResultJson = await templateMapper(TemplateEnum.CREDENTIAL_RESULT, templateData);
    const credentialResult = JSON.parse(credentialResultJson);

    const subTemplateDataPromises = subTemplates.map(async (subTemplate) => {
      const subTemplateData = await templateMapper(subTemplate, templateData);
      credentialResult[subTemplate] = JSON.parse(subTemplateData)[subTemplate];
    });

    await Promise.all(subTemplateDataPromises);
    return credentialResult;
  });

  const credentialResults = await Promise.all(credentialsResultPromises);
  return credentialResults;
};

export const getFinalReport = async (credentialResults: ICredentialTestResult[]): Promise<IFinalReport> => {
  const initFinalReport = { finalStatus: TestSuiteResultEnum.PASS, finalMessage: TestSuiteMessage.Pass } as IFinalReport;

  const finalReportTemplateData = credentialResults.reduce((acc, credential) => {
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

  const finalReportJson = await templateMapper(TemplateEnum.FINAL_REPORT, finalReportTemplateData);
  return JSON.parse(finalReportJson);
};
