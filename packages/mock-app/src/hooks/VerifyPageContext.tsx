import { createContext } from 'react';

export const VerifyPageContext = createContext({
  vc: {} as any, // TODO: replace any with W3CVerifiableCredential | EnvelopedVerifiableCredential in @vckit/core-types
});
