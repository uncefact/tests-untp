import * as vckitService from '../vckit.service';
import * as linkResolverService from '../linkResolver.service';
import * as helpers from '../epcisEvents/helpers';
import * as validateContext from '../validateContext';
import { processTransactionEvent } from '../epcisEvents/transactionEvent';
import { uploadData } from '../storage.service';
import { Result } from '../types/validateContext';
import { ITransactionEventContext } from '../types/types';
import { publicAPI } from '../utils/httpService';
import { transactionEventMock } from './mocks/constants';

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
  getLinkResolverIdentifier: jest.fn(() => ({ identifier: '9359502000010', qualifierPath: '/10/ABC123' })),
  LinkType: {
    verificationLinkType: 'gs1:verificationService',
    certificationLinkType: 'gs1:certificationInfo',
    epcisLinkType: 'gs1:epcis',
  },
}));

jest.mock('../epcisEvents/helpers', () => ({
  deleteValuesFromLocalStorageByKeyPath: jest.fn(),
}));

describe('processTransactionEvent', () => {
  const { nlisidMock, transactionEventDLRMock, transactionVCMock } = transactionEventMock;
  const transactionEvent = {
    data: {
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
  };
  const context = {
    vckit: { vckitAPIUrl: 'https://example.com', issuer: 'did:web:example.com' },
    epcisTransactionEvent: {
      context: ['https://example.sh/TransactionEvent.jsonld'],
      type: ['TransactionEventCredential'],
      dlrLinkTitle: 'Transaction Event',
      dlrIdentificationKeyType: linkResolverService.IdentificationKeyType.nlisid,
      dlrVerificationPage: 'http://exampleUI.com/verify',
    },
    dlr: { dlrAPIUrl: 'http://exampleDLR.com', dlrAPIKey: 'test-key' },
    storage: {
      url: 'https://storage.dlr.com',
      params: {
        resultPath: '',
      },
    },
    identifierKeyPath: '/transaction/identifier',
    localStorageParams: { storageKey: 'transaction', keyPath: '/transaction/type' },
  };

  it('should process transaction event', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => transactionVCMock);
    (uploadData as jest.Mock).mockImplementation(({ url, _data, path }) => {
      return `${url}/${path}`;
    });
    jest
      .spyOn(validateContext, 'validateTransactionEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as Result<ITransactionEventContext>);
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(transactionEventDLRMock);

    const transactionVC = await processTransactionEvent(transactionEvent, context);

    expect(transactionVC).toEqual({
      vc: transactionVCMock,
      linkResolver: transactionEventDLRMock,
    });
    expect(uploadData).toHaveBeenCalled();
    expect(validateContext.validateTransactionEventContext).toHaveBeenCalled();
    expect(linkResolverService.registerLinkResolver).toHaveBeenCalled();
  });

  it('should throw error if context validation throws an error', async () => {
    try {
      const invalidContext = {
        ...context,
        vckit: { vckitAPIUrl: 'invalid-url', issuer: 'invalid-issuer' },
      };
      jest
        .spyOn(validateContext, 'validateTransactionEventContext')
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
      jest
        .spyOn(validateContext, 'validateTransactionEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<ITransactionEventContext>);

      await processTransactionEvent(transactionEvent, invalidIdentifierContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Identifier not found');
      expect(validateContext.validateTransactionEventContext).toHaveBeenCalled();
    }
  });

  it('should throw error if issueVC throws an error', async () => {
    try {
      const invalidIssuerContext = {
        ...context,
        vckit: { ...context.vckit, issuer: 'invalid-issuer' },
      };
      jest
        .spyOn(validateContext, 'validateTransactionEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<ITransactionEventContext>);
      jest.spyOn(publicAPI, 'post').mockRejectedValueOnce("Can't issue VC");

      await processTransactionEvent(transactionEvent, invalidIssuerContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe("Can't issue VC");
      expect(validateContext.validateTransactionEventContext).toHaveBeenCalled();
    }
  });

  it('should throw error if storage service throws an error', async () => {
    try {
      const invalidStorageContext = {
        ...context,
        storage: { ...context.storage, storageAPIUrl: 'https://invalid-storage-provider.com' },
      };
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => transactionVCMock);
      jest
        .spyOn(validateContext, 'validateTransactionEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<ITransactionEventContext>);
      jest.spyOn(publicAPI, 'post').mockRejectedValueOnce('Invalid storage provider');

      await processTransactionEvent(transactionEvent, invalidStorageContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid storage provider');
      expect(validateContext.validateTransactionEventContext).toHaveBeenCalled();
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
      (uploadData as jest.Mock).mockResolvedValueOnce('https://storage.com/vc.json');
      jest
        .spyOn(validateContext, 'validateTransactionEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<ITransactionEventContext>);
      jest.spyOn(linkResolverService, 'createLinkResolver').mockRejectedValueOnce('Invalid DLR API link resolver url');

      await processTransactionEvent(transactionEvent, invalidDLRContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid DLR API link resolver url');
      expect(validateContext.validateTransactionEventContext).toHaveBeenCalled();
      expect(vckitService.issueVC).toHaveBeenCalled();
      expect(uploadData).toHaveBeenCalled();
    }
  });
});
