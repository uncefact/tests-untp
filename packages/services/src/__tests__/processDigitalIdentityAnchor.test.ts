import * as vckitService from '../vckit.service';
import { uploadData } from '../storage.service';
import * as linkResolverService from '../linkResolver.service';
import * as identifierSchemeServices from '../identifierSchemes/identifierSchemeServices';
import { Result } from '../types/validateContext';
import * as validateContext from '../validateContext';
import { IDigitalIdentityAnchorContext } from '../types';
import { processDigitalIdentityAnchor } from '../processDigitalIdentityAnchor.service';
import { digitalIdentityAnchorContext as context } from './mocks/constants';
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
  getLinkResolverIdentifier: jest.fn(),
  getLinkResolverIdentifierFromURI: jest.fn(),
  LinkType: {
    verificationLinkType: 'verificationService',
    certificationLinkType: 'certificationInfo',
    epcisLinkType: 'epcis',
    registryEntry: 'registryEntry',
  },
}));
jest.mock('../utils/helpers', () => ({
  ...jest.requireActual('../utils/helpers'),
  constructVerifyURL: jest.fn(),
}));

describe('processDigitalIdentityAnchor', () => {
  const digitalIdentityAnchorData = {
    data: {
      type: 'DigitalIdentityAnchor',
      id: '0123456789',
      name: 'Digital Identity Anchor',
      registeredId: '9220664869327',
    },
  };

  it('should process digital identity anchor successfully', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementation(() => ({
      credentialSubject: { id: 'https://example.com/123' },
    }));
    (vckitService.decodeEnvelopedVC as jest.Mock).mockReturnValue({
      credentialSubject: { id: 'https://example.com/123' },
    });
    (uploadData as jest.Mock).mockResolvedValueOnce({ uri: 'https://exampleStorage.com/vc.json', key: '123', hash: 'ABC123' });
    (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');

    jest
      .spyOn(validateContext, 'validateDigitalIdentityAnchorContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IDigitalIdentityAnchorContext>);
    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '01', value: '0123456789' },
      qualifiers: [],
    });
    jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/');
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    const result = await processDigitalIdentityAnchor(digitalIdentityAnchorData, context);

    expect(result.vc).toEqual({ credentialSubject: { id: 'https://example.com/123' } });
    expect(result.linkResolver).toEqual('https://example.com/link-resolver');
  });

  it('should process digital identity anchor successfully with validUntil', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementation(() => ({
      credentialSubject: { id: 'https://example.com/123' },
    }));
    (vckitService.decodeEnvelopedVC as jest.Mock).mockReturnValue({
      credentialSubject: { id: 'https://example.com/123' },
    });
    (uploadData as jest.Mock).mockResolvedValue('https://exampleStorage.com/vc.json');

    jest
      .spyOn(validateContext, 'validateDigitalIdentityAnchorContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IDigitalIdentityAnchorContext>);
    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '01', value: '0123456789' },
      qualifiers: [],
    });
    jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/');
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    const newContext = {
      ...context,
      digitalIdentityAnchor: { ...context.digitalIdentityAnchor, validUntil: '2025-12-31T23:59:59Z' },
    };
    const result = await processDigitalIdentityAnchor(digitalIdentityAnchorData, newContext);

    expect(result.vc).toEqual({ credentialSubject: { id: 'https://example.com/123' } });
    expect(result.linkResolver).toEqual('https://example.com/link-resolver');
    expect(vckitService.issueVC).toHaveBeenCalledWith(
      expect.objectContaining({
        restOfVC: expect.objectContaining({
          validUntil: '2025-12-31T23:59:59Z',
        }),
      }),
    );
  });

  it('should throw error when context validation false', async () => {
    const invalidContext: any = { ...context };
    delete invalidContext.digitalIdentityAnchor;

    jest
      .spyOn(validateContext, 'validateDigitalIdentityAnchorContext')
      .mockReturnValueOnce({ ok: false, value: 'Invalid context' });

    expect(async () => await processDigitalIdentityAnchor(digitalIdentityAnchorData, invalidContext)).rejects.toThrow(
      'Invalid context',
    );
  });

  it('should throw error when identifier not found', async () => {
    const invalidIdentifierContent = {
      ...context,
      identifierKeyPath: '/invalid',
    };

    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '', value: '' },
      qualifiers: [],
    });

    jest
      .spyOn(validateContext, 'validateDigitalIdentityAnchorContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IDigitalIdentityAnchorContext>);

    expect(
      async () => await processDigitalIdentityAnchor(digitalIdentityAnchorData, invalidIdentifierContent),
    ).rejects.toThrow('Identifier not found');
  });

  it('should throw error when DigitalIdentityAnchor data not found', async () => {
    const invalidDigitalIdentityAnchorData = {
      ...digitalIdentityAnchorData,
      data: undefined,
    };

    jest
      .spyOn(validateContext, 'validateDigitalIdentityAnchorContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IDigitalIdentityAnchorContext>);

    expect(async () => await processDigitalIdentityAnchor(invalidDigitalIdentityAnchorData, context)).rejects.toThrow(
      'digitalIdentityAnchor data not found',
    );
  });

  it('should process digital identity anchor with custom verifiable credential service headers', async () => {
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
    (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');

    jest
      .spyOn(validateContext, 'validateDigitalIdentityAnchorContext')
      .mockReturnValueOnce({ ok: true, value: contextWithHeaders } as unknown as Result<IDigitalIdentityAnchorContext>);
    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '01', value: '0123456789' },
      qualifiers: [],
    });
    jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/');
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    await processDigitalIdentityAnchor(digitalIdentityAnchorData, contextWithHeaders);

    expect(vckitService.issueVC).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: mockHeaders,
      }),
    );
  });
});
