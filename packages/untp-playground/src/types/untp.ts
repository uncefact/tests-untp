import { permittedCredentialTypes } from '../../constants';

export type PermittedCredentialType = (typeof permittedCredentialTypes)[number];
