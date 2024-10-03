import { W3CVerifiableCredential } from '@vckit/core-types';
import { createContext } from 'react';

export const VerifyPageContext = createContext({
  verifiableCredential: {} as W3CVerifiableCredential,
});
