import { FinalStatus, ICredentialTestResult, IFinalReport, TestSuiteMessage } from '../core/types/index.js';

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
