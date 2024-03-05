import * as vckitService from '../vckit.service';
import * as linkResolverService from '../linkResolver.service';
import * as helpers from '../epcisEvents/helpers';
import * as validateContext from '../epcisEvents/validateContext';
import { processTransactionEvent } from '../epcisEvents/transactionEvent';
import { uploadJson } from '../storage.service';
import { Result } from '../types/validateContext';
import { ITransactionEventContext } from '../epcisEvents/types';
import { publicAPI } from '../utils/httpService';
import { transactionEventMock } from './mocks/constants';

jest.mock('../vckit.service', () => ({
  issueVC: jest.fn(),
}));
jest.mock('../storage.service', () => ({
  uploadJson: jest.fn(),
}));
jest.mock('../linkResolver.service', () => ({
  registerLinkResolver: jest.fn(),
  createLinkResolver: jest.fn(),
  IdentificationKeyType: jest.fn(),
}));

describe('processTransactionEvent', () => {
  const { nlisidMock, uploadedTransactionEventLinkMock, transactionEventDLRMock, transactionVCMock } = transactionEventMock;
  const transactionEvent = {
    data: {
      parentItem: { itemID: nlisidMock, name: 'Beef Steak Variety Container' },
      childItems: [{ itemID: 'http://example.com/beef-scotch-box.json', name: 'Beef Scotch Fillet Box' }],
      childQuantityList: [{ productClass: 'Beef', quantity: '50', uom: 'units' }],
      locationId: 'https://plus.codes/123MHR+PW',
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
    storage: { storageAPIUrl: 'https://storage.dlr.com', bucket: 'agtrace-test-verifiable-credentials' },
    identifierKeyPaths: ['transaction', 'identifier'],
  };

  it('should process transaction event', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => transactionVCMock);
    (uploadJson as jest.Mock).mockImplementationOnce(() => uploadedTransactionEventLinkMock);
    jest
      .spyOn(validateContext, 'validateTransactionEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as Result<ITransactionEventContext>);
    jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(nlisidMock);
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(transactionEventDLRMock);

    const transactionVC = await processTransactionEvent(transactionEvent, context);

    expect(transactionVC).toBe(transactionVCMock);
    expect(uploadJson).toHaveBeenCalled();
    expect(validateContext.validateTransactionEventContext).toHaveBeenCalled();
    expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
    expect(linkResolverService.registerLinkResolver).toHaveBeenCalled();
  });

  it('should throw error if context validation throws an error', async () => {
    try {
      jest
        .spyOn(validateContext, 'validateTransactionEventContext')
        .mockReturnValueOnce({ ok: false, value: 'Invalid context' });

      await processTransactionEvent(transactionEvent, context);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid context');
    }
  });

  it('should throw error if identifier not found', async () => {
    try {
      jest
        .spyOn(validateContext, 'validateTransactionEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<ITransactionEventContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(undefined);

      await processTransactionEvent(transactionEvent, context);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Identifier not found');
      expect(validateContext.validateTransactionEventContext).toHaveBeenCalled();
    }
  });

  it('should throw error if issueVC throws an error', async () => {
    try {
      jest
        .spyOn(validateContext, 'validateTransactionEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<ITransactionEventContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(nlisidMock);
      jest.spyOn(publicAPI, 'post').mockRejectedValueOnce("Can't issue VC");

      await processTransactionEvent(transactionEvent, context);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe("Can't issue VC");
      expect(validateContext.validateTransactionEventContext).toHaveBeenCalled();
      expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
    }
  });

  it('should throw error if uploadJson throws an error', async () => {
    try {
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => transactionVCMock);
      jest
        .spyOn(validateContext, 'validateTransactionEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<ITransactionEventContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(nlisidMock);
      jest.spyOn(publicAPI, 'put').mockRejectedValueOnce('Error upload json');

      await processTransactionEvent(transactionEvent, context);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Error upload json');
      expect(validateContext.validateTransactionEventContext).toHaveBeenCalled();
      expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
      expect(vckitService.issueVC).toHaveBeenCalled();
    }
  });

  it('should throw error if registerLinkResolver throws an error', async () => {
    try {
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => transactionVCMock);
      (uploadJson as jest.Mock).mockImplementationOnce(() => uploadedTransactionEventLinkMock);
      jest
        .spyOn(validateContext, 'validateTransactionEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<ITransactionEventContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(nlisidMock);
      jest.spyOn(linkResolverService, 'createLinkResolver').mockRejectedValueOnce('Error creating link resolver');

      await processTransactionEvent(transactionEvent, context);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Error creating link resolver');
      expect(validateContext.validateTransactionEventContext).toHaveBeenCalled();
      expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
      expect(vckitService.issueVC).toHaveBeenCalled();
      expect(uploadJson).toHaveBeenCalled();
    }
  });
});
