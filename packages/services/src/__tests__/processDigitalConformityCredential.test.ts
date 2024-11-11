import * as vckitService from '../vckit.service';
import { uploadData } from '../storage.service';
import * as linkResolverService from '../linkResolver.service';
import { Result } from '../types/validateContext';
import * as validateContext from '../validateContext';
import { IDigitalConformityCredentialContext } from '../types';
import { processDigitalConformityCredential } from '../processDigitalConformityCredential.service';
import { digitalConformityCredentialContext as context } from './mocks/constants';
import { constructVerifyURL } from '../utils/helpers';

jest.mock('../vckit.service', () => ({
  issueVC: jest.fn(),
  decodeEnvelopedVC: jest.fn(),
}));
jest.mock('../storage.service', () => ({
  uploadData: jest.fn(),
}));
jest.mock('../linkResolver.service', () => ({
  registerLinkResolver: jest.fn(),
  createLinkResolver: jest.fn(),
  IdentificationKeyType: jest.fn(),
  getLinkResolverIdentifier: jest.fn(),
  getLinkResolverIdentifierFromURI: jest.fn(),
  LinkType: {
    verificationLinkType: 'verificationService',
    certificationLinkType: 'certificationInfo',
    epcisLinkType: 'epcis',
  },
}));
jest.mock('../utils/helpers', () => ({
  ...jest.requireActual('../utils/helpers'),
  constructVerifyURL: jest.fn(),
}));

describe('processDigitalConformityCredential', () => {
  const digitalConformityCredentialData = {
    data: {
      type: 'DigitalConformityCredential',
      id: '0123456789',
      name: 'Digital Conformity Credential',
      registeredId: '9220664869327',
    },
  };

  it('should process digital conformity credential successfully', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementation(() => ({
      credentialSubject: { id: 'https://example.com/123' },
    }));
    (uploadData as jest.Mock).mockResolvedValueOnce({ uri: 'https://exampleStorage.com/vc.json', key: '123', hash: 'ABC123' });
    (constructVerifyURL as jest.Mock).mockReturnValueOnce('https://example.com/vc.json');

    jest
      .spyOn(validateContext, 'validateDigitalConformityCredentialContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IDigitalConformityCredentialContext>);
    jest
      .spyOn(linkResolverService, 'getLinkResolverIdentifier')
      .mockReturnValue({ identifier: '0123456789', qualifierPath: '/' });
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    const result = await processDigitalConformityCredential(digitalConformityCredentialData, context);

    expect(result.vc).toEqual({ credentialSubject: { id: 'https://example.com/123' } });
    expect(result.linkResolver).toEqual('https://example.com/link-resolver');
  });

  it('should throw error when context validation false', async () => {
    const invalidContext: any = { ...context };
    delete invalidContext.digitalConformityCredential;

    jest
      .spyOn(validateContext, 'validateDigitalConformityCredentialContext')
      .mockReturnValueOnce({ ok: false, value: 'Invalid context' });

    expect(
      async () => await processDigitalConformityCredential(digitalConformityCredentialData, invalidContext),
    ).rejects.toThrow('Invalid context');
  });

  it('should throw error when identifier not found', async () => {
    const invalidIdentifierContent = {
      ...context,
      identifierKeyPath: '/invalid',
    };

    jest
      .spyOn(validateContext, 'validateDigitalConformityCredentialContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IDigitalConformityCredentialContext>);

    expect(
      async () => await processDigitalConformityCredential(digitalConformityCredentialData, invalidIdentifierContent),
    ).rejects.toThrow('Identifier not found');
  });

  it('should throw error when DigitalConformityCredential data not found', async () => {
    const invalidDigitalConformityCredentialData = {
      ...digitalConformityCredentialData,
      data: undefined,
    };

    jest
      .spyOn(validateContext, 'validateDigitalConformityCredentialContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IDigitalConformityCredentialContext>);

    expect(
      async () => await processDigitalConformityCredential(invalidDigitalConformityCredentialData, context),
    ).rejects.toThrow('digitalConformityCredential data not found');
  });

  it('should process digital conformity credential with custom verifiable credential service headers', async () => {
    const mockHeaders = { 'X-Custom-Header': 'test-value' };
    const contextWithHeaders = {
      ...context,
      vckit: {
        ...context.vckit,
        headers: mockHeaders,
      },
    };

    (vckitService.issueVC as jest.Mock).mockImplementation(() => ({
      credentialSubject: { id: 'https://example.com/123' },
    }));
    (uploadData as jest.Mock).mockResolvedValueOnce({ uri: 'https://exampleStorage.com/vc.json', key: '123', hash: 'ABC123' });
    (constructVerifyURL as jest.Mock).mockReturnValueOnce('https://example.com/vc.json');

    jest.spyOn(validateContext, 'validateDigitalConformityCredentialContext').mockReturnValueOnce({
      ok: true,
      value: contextWithHeaders,
    } as unknown as Result<IDigitalConformityCredentialContext>);
    jest
      .spyOn(linkResolverService, 'getLinkResolverIdentifier')
      .mockReturnValue({ identifier: '0123456789', qualifierPath: '/' });
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    await processDigitalConformityCredential(digitalConformityCredentialData, contextWithHeaders);

    expect(vckitService.issueVC).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: mockHeaders,
      }),
    );
  });
});
