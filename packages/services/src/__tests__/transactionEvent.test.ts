import * as vckitService from '../vckit.service';
import * as linkResolverService from '../linkResolver.service';
import * as validateContext from '../validateContext';
import { processTransactionEvent } from '../epcisEvents/transactionEvent';
import * as identifierSchemeServices from '../identifierSchemes/identifierSchemeServices';
import { uploadData } from '../storage.service';
import { Result } from '../types/validateContext';
import { ITraceabilityEventContext } from '../types/types';
import { publicAPI } from '../utils/httpService';
import { transactionEventMock } from './mocks/constants';
import { constructVerifyURL } from '../utils/helpers';
import { issueVC } from '../vckit.service';
import { deleteValuesFromLocalStorageByKeyPath } from '../epcisEvents/helpers';

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
  LinkType: {
    verificationLinkType: 'gs1:verificationService',
    certificationLinkType: 'gs1:certificationInfo',
    epcisLinkType: 'gs1:epcis',
    traceability: 'traceability',
  },
}));

jest.mock('../epcisEvents/helpers', () => ({
  deleteValuesFromLocalStorageByKeyPath: jest.fn(),
}));
jest.mock('../utils/helpers', () => ({
  ...jest.requireActual('../utils/helpers'),
  constructVerifyURL: jest.fn(),
}));

const { transactionEventDLRMock, transactionVCMock } = transactionEventMock;

const transactionEvent = {
  data: [
    {
      sourceParty: { partyID: `https://beef-steak-shop.com/info.json`, name: 'Beef Steak Shop' },
      destinationParty: { partyID: 'https://beef-shop.com/info.json', name: 'Beef Shop' },
      transaction: {
        type: 'inv',
        identifier: 'uuid-123456',
        documentURL: 'https://transaction-example.com/trans-uuid-1.json',
      },
      itemList: [{ itemID: 'https://beef-example.com/info-uuid-1.json', name: 'Beef' }],
      quantityList: [{ productClass: 'Beef', quantity: '50', uom: 'units' }],
    },
  ],
};

const context = {
  vckit: { vckitAPIUrl: 'https://example.com', issuer: 'did:web:example.com' },
  traceabilityEvent: {
    context: ['https://example.sh/TransactionEvent.jsonld'],
    type: ['DigitalTraceabilityEvent'],
    dlrLinkTitle: 'Transaction Event',
    dlrVerificationPage: 'http://exampleUI.com/verify',
  },
  dlr: { dlrAPIUrl: 'http://exampleDLR.com', dlrAPIKey: 'test-key' },
  storage: {
    url: 'https://storage.dlr.com',
    params: {},
  },
  identifierKeyPath: '/0/transaction/identifier',
  localStorageParams: { storageKey: 'transaction', keyPath: '/transaction/type' },
};

describe('processTransactionEvent', () => {
  it('should process transaction event', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => transactionVCMock);
    (vckitService.decodeEnvelopedVC as jest.Mock).mockReturnValue(transactionVCMock);
    (uploadData as jest.Mock).mockResolvedValueOnce({
      uri: 'https://exampleStorage.com/vc.json',
      key: '123',
      hash: 'ABC123',
    });
    (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '01', value: '9359502000010' },
      qualifiers: [
        {
          ai: '10',
          value: 'ABC123',
        },
      ],
    });
    jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/10/ABC123');
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(transactionEventDLRMock);

    const transactionVC = await processTransactionEvent(transactionEvent, context);

    expect(transactionVC).toEqual({
      vc: transactionVCMock,
      decodedEnvelopedVC: transactionVCMock,
      linkResolver: transactionEventDLRMock,
    });
    expect(uploadData).toHaveBeenCalled();
    expect(validateContext.validateTraceabilityEventContext).toHaveBeenCalled();
    expect(linkResolverService.registerLinkResolver).toHaveBeenCalled();
  });

  it('should process transaction event with validUntil', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => transactionVCMock);
    (vckitService.decodeEnvelopedVC as jest.Mock).mockReturnValue(transactionVCMock);
    (uploadData as jest.Mock).mockImplementation(({ url, _data, path }) => {
      return `${url}/${path}`;
    });

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '01', value: '9359502000010' },
      qualifiers: [
        {
          ai: '10',
          value: 'ABC123',
        },
      ],
    });
    jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/10/ABC123');
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(transactionEventDLRMock);

    const newContext = {
      ...context,
      traceabilityEvent: { ...context.traceabilityEvent, validUntil: '2025-12-31T23:59:59Z' },
    };
    const transactionVC = await processTransactionEvent(transactionEvent, newContext);

    expect(transactionVC).toEqual({
      vc: transactionVCMock,
      decodedEnvelopedVC: transactionVCMock,
      linkResolver: transactionEventDLRMock,
    });
    expect(uploadData).toHaveBeenCalled();
    expect(validateContext.validateTraceabilityEventContext).toHaveBeenCalled();
    expect(linkResolverService.registerLinkResolver).toHaveBeenCalled();
    expect(vckitService.issueVC).toHaveBeenCalledWith(
      expect.objectContaining({
        restOfVC: expect.objectContaining({
          validUntil: '2025-12-31T23:59:59Z',
        }),
      }),
    );
  });

  it('should throw error if context validation throws an error', async () => {
    try {
      const invalidContext = {
        ...context,
        vckit: { vckitAPIUrl: 'invalid-url', issuer: 'invalid-issuer' },
      };
      jest
        .spyOn(validateContext, 'validateTraceabilityEventContext')
        .mockReturnValueOnce({ ok: false, value: 'Invalid context' });

      await processTransactionEvent(transactionEvent, invalidContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid context');
    }
  });

  it('should throw error if identifier not found', async () => {
    try {
      const invalidIdentifierContext = {
        ...context,
        identifierKeyPath: '/invalid-key',
      };

      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '', value: '' },
        qualifiers: [
          {
            ai: '10',
            value: 'ABC123',
          },
        ],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/10/ABC123');
      jest
        .spyOn(validateContext, 'validateTraceabilityEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);

      await processTransactionEvent(transactionEvent, invalidIdentifierContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Identifier not found');
      expect(validateContext.validateTraceabilityEventContext).toHaveBeenCalled();
    }
  });

  it('should throw error if issueVC throws an error', async () => {
    try {
      const invalidIssuerContext = {
        ...context,
        vckit: { ...context.vckit, issuer: 'invalid-issuer' },
      };
      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '01', value: '9359502000010' },
        qualifiers: [
          {
            ai: '10',
            value: 'ABC123',
          },
        ],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/10/ABC123');
      jest
        .spyOn(validateContext, 'validateTraceabilityEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
      (issueVC as jest.Mock).mockRejectedValueOnce(new Error("Can't issue VC"));

      await processTransactionEvent(transactionEvent, invalidIssuerContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe("Can't issue VC");
      expect(validateContext.validateTraceabilityEventContext).toHaveBeenCalled();
    }
  });

  it('should throw error if storage service throws an error', async () => {
    try {
      const invalidStorageContext = {
        ...context,
        storage: { ...context.storage, storageAPIUrl: 'https://invalid-storage-provider.com' },
      };
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => transactionVCMock);
      (vckitService.decodeEnvelopedVC as jest.Mock).mockReturnValue(transactionVCMock);
      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '01', value: '9359502000010' },
        qualifiers: [
          {
            ai: '10',
            value: 'ABC123',
          },
        ],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/10/ABC123');

      jest
        .spyOn(validateContext, 'validateTraceabilityEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
      (uploadData as jest.Mock).mockRejectedValueOnce(new Error('Invalid storage provider'));

      await processTransactionEvent(transactionEvent, invalidStorageContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid storage provider');
      expect(validateContext.validateTraceabilityEventContext).toHaveBeenCalled();
      expect(vckitService.issueVC).toHaveBeenCalled();
    }
  });

  it('should throw error if registerLinkResolver throws an error', async () => {
    try {
      const invalidDLRContext = {
        ...context,
        dlr: { ...context.dlr, dlrAPIUrl: 'http://invalid-dlr.com' },
      };
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => transactionVCMock);
      (uploadData as jest.Mock).mockResolvedValueOnce({
        uri: 'https://exampleStorage.com/vc.json',
        key: '123',
        hash: 'ABC123',
      });
      (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');

      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '01', value: '9359502000010' },
        qualifiers: [
          {
            ai: '10',
            value: 'ABC123',
          },
        ],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/10/ABC123');
      jest
        .spyOn(validateContext, 'validateTraceabilityEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
      jest.spyOn(linkResolverService, 'createLinkResolver').mockRejectedValueOnce('Invalid DLR API link resolver url');

      await processTransactionEvent(transactionEvent, invalidDLRContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid DLR API link resolver url');
      expect(validateContext.validateTraceabilityEventContext).toHaveBeenCalled();
      expect(vckitService.issueVC).toHaveBeenCalled();
      expect(uploadData).toHaveBeenCalled();
    }
  });

  it('should process transaction event with custom verifiable credential service headers', async () => {
    const mockHeaders = { 'X-Custom-Header': 'test-value' };
    const contextWithHeaders = {
      ...context,
      vckit: {
        ...context.vckit,
        headers: mockHeaders,
      },
    };

    (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => transactionVCMock);
    (uploadData as jest.Mock).mockResolvedValueOnce({
      uri: 'https://exampleStorage.com/vc.json',
      key: '123',
      hash: 'ABC123',
    });
    (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');
    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: contextWithHeaders } as unknown as Result<ITraceabilityEventContext>);
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(transactionEventDLRMock);

    const transactionVC = await processTransactionEvent(transactionEvent, contextWithHeaders);

    expect(transactionVC).toEqual({
      vc: transactionVCMock,
      decodedEnvelopedVC: transactionVCMock,
      linkResolver: transactionEventDLRMock,
    });
    expect(vckitService.issueVC).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: mockHeaders,
      }),
    );
    expect(uploadData).toHaveBeenCalled();
    expect(validateContext.validateTraceabilityEventContext).toHaveBeenCalled();
    expect(linkResolverService.registerLinkResolver).toHaveBeenCalled();
  });
});

describe('deleteValuesFromLocalStorageByKeyPath functionality', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => transactionVCMock);
    (vckitService.decodeEnvelopedVC as jest.Mock).mockReturnValue(transactionVCMock);
    (uploadData as jest.Mock).mockResolvedValueOnce({
      uri: 'https://exampleStorage.com/vc.json',
      key: '123',
      hash: 'ABC123',
    });
    (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');
    
    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '01', value: '9359502000010' },
      qualifiers: [{ ai: '10', value: 'ABC123' }],
    });
    jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/10/ABC123');
    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(transactionEventDLRMock);
  });

  it('should call deleteValuesFromLocalStorageByKeyPath when both storageKey and keyPath are provided', async () => {
    const contextWithLocalStorage = {
      ...context,
      localStorageParams: { storageKey: 'transaction', keyPath: '/transaction/type' },
    };

    await processTransactionEvent(transactionEvent, contextWithLocalStorage);

    expect(deleteValuesFromLocalStorageByKeyPath).toHaveBeenCalledWith(
      'transaction',
      transactionEvent.data,
      '/transaction/type',
    );
  });

  it('should not call deleteValuesFromLocalStorageByKeyPath when localStorageParams is undefined', async () => {
    const contextWithoutLocalStorage = {
      ...context,
      localStorageParams: undefined,
    };

    await processTransactionEvent(transactionEvent, contextWithoutLocalStorage);

    expect(deleteValuesFromLocalStorageByKeyPath).not.toHaveBeenCalled();
  });

  it('should not call deleteValuesFromLocalStorageByKeyPath when storageKey is missing', async () => {
    const contextWithMissingStorageKey = {
      ...context,
      localStorageParams: { keyPath: '/transaction/type' },
    };

    await processTransactionEvent(transactionEvent, contextWithMissingStorageKey);

    expect(deleteValuesFromLocalStorageByKeyPath).not.toHaveBeenCalled();
  });

  it('should not call deleteValuesFromLocalStorageByKeyPath when keyPath is missing', async () => {
    const contextWithMissingKeyPath = {
      ...context,
      localStorageParams: { storageKey: 'transaction' },
    };

    await processTransactionEvent(transactionEvent, contextWithMissingKeyPath);

    expect(deleteValuesFromLocalStorageByKeyPath).not.toHaveBeenCalled();
  });

  it('should not call deleteValuesFromLocalStorageByKeyPath when both storageKey and keyPath are empty strings', async () => {
    const contextWithEmptyValues = {
      ...context,
      localStorageParams: { storageKey: '', keyPath: '' },
    };

    await processTransactionEvent(transactionEvent, contextWithEmptyValues);

    expect(deleteValuesFromLocalStorageByKeyPath).not.toHaveBeenCalled();
  });

  it('should not call deleteValuesFromLocalStorageByKeyPath when storageKey is null', async () => {
    const contextWithNullStorageKey = {
      ...context,
      localStorageParams: { storageKey: null, keyPath: '/transaction/type' },
    };

    await processTransactionEvent(transactionEvent, contextWithNullStorageKey);

    expect(deleteValuesFromLocalStorageByKeyPath).not.toHaveBeenCalled();
  });
});
