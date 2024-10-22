import * as vckitService from '../vckit.service';
import { uploadData } from '../storage.service';
import * as linkResolverService from '../linkResolver.service';
import { Result } from '../types/validateContext';
import * as validateContext from '../validateContext';
import { IDigitalFacilityRecordContext } from '../types';
import { processDigitalFacilityRecord } from '../processDigitalFacilityRecord.service';
import { digitalFacilityRecordContext as context } from './mocks/constants';

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

describe('processDigitalFacilityRecord', () => {
  const digitalFacilityRecordData = {
    data: {
      type: 'DigitalFacilityRecord',
      id: '0123456789',
      name: 'Digital Facility Record',
      registeredId: '9220664869327',
    },
  };

  it('should process digital facility record successfully', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementation(() => ({
      credentialSubject: { id: 'https://example.com/123' },
    }));
    (uploadData as jest.Mock).mockResolvedValue('https://exampleStorage.com/vc.json');

    jest
      .spyOn(validateContext, 'validateDigitalFacilityRecordContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IDigitalFacilityRecordContext>);
    jest
      .spyOn(linkResolverService, 'getLinkResolverIdentifier')
      .mockReturnValue({ identifier: '0123456789', qualifierPath: '/' });
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    const result = await processDigitalFacilityRecord(digitalFacilityRecordData, context);

    expect(result.vc).toEqual({ credentialSubject: { id: 'https://example.com/123' } });
    expect(result.linkResolver).toEqual('https://example.com/link-resolver');
  });

  it('should throw error when context validation false', async () => {
    const invalidContext: any = { ...context };
    delete invalidContext.digitalFacilityRecord;

    jest
      .spyOn(validateContext, 'validateDigitalFacilityRecordContext')
      .mockReturnValueOnce({ ok: false, value: 'Invalid context' });

    expect(async () => await processDigitalFacilityRecord(digitalFacilityRecordData, invalidContext)).rejects.toThrow(
      'Invalid context',
    );
  });

  it('should throw error when identifier not found', async () => {
    const invalidIdentifierContent = {
      ...context,
      identifierKeyPath: '/invalid',
    };

    jest
      .spyOn(validateContext, 'validateDigitalFacilityRecordContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IDigitalFacilityRecordContext>);

    expect(
      async () => await processDigitalFacilityRecord(digitalFacilityRecordData, invalidIdentifierContent),
    ).rejects.toThrow('Identifier not found');
  });

  it('should throw error when DigitalFacilityRecord data not found', async () => {
    const invalidDigitalFacilityRecordData = {
      ...digitalFacilityRecordData,
      data: undefined,
    };

    jest
      .spyOn(validateContext, 'validateDigitalFacilityRecordContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IDigitalFacilityRecordContext>);

    expect(async () => await processDigitalFacilityRecord(invalidDigitalFacilityRecordData, context)).rejects.toThrow(
      'digitalFacilityRecord data not found',
    );
  });

  it('should process digital facility record with custom verifiable credential service headers', async () => {
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
    (uploadData as jest.Mock).mockResolvedValue('https://exampleStorage.com/vc.json');

    jest
      .spyOn(validateContext, 'validateDigitalFacilityRecordContext')
      .mockReturnValueOnce({ ok: true, value: contextWithHeaders } as unknown as Result<IDigitalFacilityRecordContext>);
    jest
      .spyOn(linkResolverService, 'getLinkResolverIdentifier')
      .mockReturnValue({ identifier: '0123456789', qualifierPath: '/' });
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    await processDigitalFacilityRecord(digitalFacilityRecordData, contextWithHeaders);

    expect(vckitService.issueVC).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: mockHeaders,
      }),
    );
  });
});
