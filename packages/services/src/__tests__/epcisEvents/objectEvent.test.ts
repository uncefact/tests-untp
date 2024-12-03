import { ITraceabilityEvent } from '../../types';
import { processObjectEvent } from '../../epcisEvents/objectEvent';
import * as vckitService from '../../vckit.service';
import { uploadData } from '../../storage.service';
import * as linkResolverService from '../../linkResolver.service';
import * as identifierSchemeServices from '../../identifierSchemes/identifierSchemeServices';
import { ITraceabilityEventContext } from '../../types';
import { Result } from '../../types/validateContext';
import * as validateContext from '../../validateContext';
import { traceabilityEventContext as context } from '../mocks/constants';
import { constructVerifyURL } from '../../utils/helpers';

jest.mock('../../vckit.service', () => ({
  issueVC: jest.fn(),
  decodeEnvelopedVC: jest.fn(),
}));
jest.mock('../../storage.service', () => ({
  uploadData: jest.fn(),
}));
jest.mock('../../linkResolver.service', () => ({
  registerLinkResolver: jest.fn(),
  createLinkResolver: jest.fn(),
  LinkType: {
    verificationLinkType: 'verificationService',
    certificationLinkType: 'certificationInfo',
    epcisLinkType: 'epcis',
    traceability: 'traceability',
  },
}));
jest.mock('../../utils/helpers', () => ({
  ...jest.requireActual('../../utils/helpers'),
  constructVerifyURL: jest.fn(),
}));

describe('processObjectEvent', () => {
  const objectEvent: ITraceabilityEvent = {
    data: [
      {
        id: '010501234567890021951350380',
        type: 'urn:epcglobal:cbv:mda',
        action: 'OBSERVE',
        bizStep: 'urn:epcglobal:cbv:bizstep:receiving',
        disposition: 'urn:epcglobal:cbv:disp:in_progress',
        readPoint: {
          id: 'urn:uuid:60a76c80-d399-11eb-8d0a-0242ac130003',
        },
        bizLocation: {
          id: 'urn:uuid:60a76c80-d399-11eb-8d0a-0242ac130003',
        },
        bizTransactionList: [
          {
            type: 'urn:epcglobal:cbv:btt:po',
            bizTransaction: 'http://transaction.acme.com/po/12345678',
          },
        ],
        epcList: [
          {
            epc: 'urn:epc:id:sgtin:0614141.107346.2021',
            quantity: 1,
          },
        ],
      },
    ],
  };

  it('should process object event successfully', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementation(() => ({
      credentialSubject: { id: 'https://example.com/123' },
    }));
    (vckitService.decodeEnvelopedVC as jest.Mock).mockReturnValue({
      credentialSubject: { id: 'https://example.com/123' },
    });
    (uploadData as jest.Mock).mockResolvedValueOnce({ uri: 'https://exampleStorage.com/vc.json', key: '123', hash: 'ABC123' });
    (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '01', value: '0105012345678900' },
      qualifiers: [
        { ai: '21', value: '951350380' },
        { ai: '10', value: 'ABC123' },
      ],
    });
    jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/21/951350380/10/ABC123');
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    const result = await processObjectEvent(objectEvent, context);

    expect(result.vc).toEqual({ credentialSubject: { id: 'https://example.com/123' } });
    expect(result.linkResolver).toEqual('https://example.com/link-resolver');
  });

  it('should process object event successfully with validUntil', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementation(() => ({
      credentialSubject: { id: 'https://example.com/123' },
    }));
    (vckitService.decodeEnvelopedVC as jest.Mock).mockReturnValue({
      credentialSubject: { id: 'https://example.com/123' },
    });
    (uploadData as jest.Mock).mockResolvedValue('https://exampleStorage.com/vc.json');

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '01', value: '0105012345678900' },
      qualifiers: [
        { ai: '21', value: '951350380' },
        { ai: '10', value: 'ABC123' },
      ],
    });
    jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/21/951350380/10/ABC123');
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    const newContext = {
      ...context,
      traceabilityEvent: { ...context.traceabilityEvent, validUntil: '2025-12-31T23:59:59Z' },
    };
    const result = await processObjectEvent(objectEvent, newContext);

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
    delete invalidContext.traceabilityEvent;

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: false, value: 'Invalid context' });

    expect(async () => await processObjectEvent(objectEvent, invalidContext)).rejects.toThrow('Invalid context');
  });

  it('should throw error when identifier not found', async () => {
    const invalidIdentifierContent = {
      ...context,
      identifierKeyPath: '/invalid',
    };
    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '', value: '' },
      qualifiers: [
        { ai: '21', value: '951350380' },
        { ai: '10', value: 'ABC123' },
      ],
    });

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);

    expect(async () => await processObjectEvent(objectEvent, invalidIdentifierContent)).rejects.toThrow(
      'Identifier not found',
    );
  });

  it('should throw error when ObjectEvent data not found', async () => {
    const invalidObjectEvent = {
      ...objectEvent,
      data: undefined,
    };

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);

    expect(async () => await processObjectEvent(invalidObjectEvent, context)).rejects.toThrow(
      'Object event data not found',
    );
  });

  it('should process object event with custom verifiable credential service headers', async () => {
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
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '01', value: '0105012345678900' },
      qualifiers: [
        { ai: '21', value: '951350380' },
        { ai: '10', value: 'ABC123' },
      ],
    });
    jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/21/951350380/10/ABC123');
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    await processObjectEvent(objectEvent, contextWithHeaders);

    expect(vckitService.issueVC).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: mockHeaders,
      }),
    );
  });
});
