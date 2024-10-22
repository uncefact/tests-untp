import * as vckitService from '../vckit.service';
import { uploadData } from '../storage.service';
import * as linkResolverService from '../linkResolver.service';
import { Result } from '../types/validateContext';
import * as validateContext from '../validateContext';
import { IDigitalIdentityAnchorContext } from '../types';
import { processDigitalIdentityAnchor } from '../processDigitalIdentityAnchor.service';
import { digitalIdentityAnchorContext as context } from './mocks/constants';

jest.mock('../vckit.service', () => ({
  issueVC: jest.fn(),
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
    (uploadData as jest.Mock).mockResolvedValue('https://exampleStorage.com/vc.json');

    jest
      .spyOn(validateContext, 'validateDigitalIdentityAnchorContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IDigitalIdentityAnchorContext>);
    jest
      .spyOn(linkResolverService, 'getLinkResolverIdentifier')
      .mockReturnValue({ identifier: '0123456789', qualifierPath: '/' });
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    const result = await processDigitalIdentityAnchor(digitalIdentityAnchorData, context);

    expect(result.vc).toEqual({ credentialSubject: { id: 'https://example.com/123' } });
    expect(result.linkResolver).toEqual('https://example.com/link-resolver');
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
});
