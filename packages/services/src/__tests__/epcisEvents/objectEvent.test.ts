import { ITraceabilityEvent } from '../../types';
import { processObjectEvent } from '../../epcisEvents/objectEvent';
import * as vckitService from '../../vckit.service';
import { getStorageServiceLink } from '../../storage.service';
import * as linkResolverService from '../../linkResolver.service';
import { IAggregationEventContext, IObjectEventContext } from '../../types';
import { Result } from '../../types/validateContext';
import * as validateContext from '../../validateContext';
import { objectEventContext as context } from '../mocks/constants';

jest.mock('../../vckit.service', () => ({
  issueVC: jest.fn(),
}));
jest.mock('../../storage.service', () => ({
  getStorageServiceLink: jest.fn(),
}));
jest.mock('../../linkResolver.service', () => ({
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

describe('processObjectEvent', () => {
  const objectEvent: ITraceabilityEvent = {
    data: {
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
  };

  it('should process object event successfully', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementation(() => ({
      credentialSubject: { id: 'https://example.com/123' },
    }));
    (getStorageServiceLink as jest.Mock).mockResolvedValue('https://exampleStorage.com/vc.json');

    jest
      .spyOn(validateContext, 'validateObjectEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IObjectEventContext>);
    jest
      .spyOn(linkResolverService, 'getLinkResolverIdentifier')
      .mockReturnValue({ identifier: '0123456789', qualifierPath: '/10/ABC123' });
    jest.spyOn(linkResolverService, 'getLinkResolverIdentifierFromURI').mockReturnValueOnce({
      identifier: '0123456789',
      qualifierPath: '/10/ABC123',
      elementString: '01012345678910ABC123',
    });
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValue('https://example.com/link-resolver');

    const result = await processObjectEvent(objectEvent, context);

    expect(result.vc).toEqual({ credentialSubject: { id: 'https://example.com/123' } });
    expect(result.linkResolver).toEqual('https://example.com/link-resolver');
  });

  it('should throw error when context validation false', async () => {
    const invalidContext: any = { ...context };
    delete invalidContext.epcisObjectEvent;

    jest
      .spyOn(validateContext, 'validateObjectEventContext')
      .mockReturnValueOnce({ ok: false, value: 'Invalid context' });

    expect(async () => await processObjectEvent(objectEvent, invalidContext)).rejects.toThrow('Invalid context');
  });

  it('should throw error when identifier not found', async () => {
    const invalidIdentifierContent = {
      ...context,
      identifierKeyPath: '/invalid',
    };

    jest
      .spyOn(validateContext, 'validateObjectEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IObjectEventContext>);

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
      .spyOn(validateContext, 'validateObjectEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<IObjectEventContext>);

    expect(async () => await processObjectEvent(invalidObjectEvent, context)).rejects.toThrow(
      'Object event data not found',
    );
  });
});
