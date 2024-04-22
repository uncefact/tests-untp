import * as vckitService from '../vckit.service';
import { uploadJson } from '../storage.service';
import * as linkResolverService from '../linkResolver.service';
import { IAggregationEventContext } from '../epcisEvents/types';
import { Result } from '../types/validateContext';
import * as validateContext from '../epcisEvents/validateContext';
import * as helpers from '../epcisEvents/helpers';
import { processAggregationEvent } from '../epcisEvents';
import { publicAPI } from '../utils/httpService';
import { aggregationEventMock } from './mocks/constants';

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

describe('processAggregationEvent', () => {
  const { parentEPC, aggregationVCMock, uploadedAggregationEventLinkMock, aggregationEventDLRMock } = aggregationEventMock;
  const aggregationEvent = {
    data: {
      parentEPC: { itemID: [{ ai: '01', value: '09359502000010' }], name: 'Beef Variety Container' },
      childEPCs: [{ itemID: 'http://example.com/beef-scotch-box.json', name: 'Beef Scotch Fillet Box' }],
      childQuantityList: [{ productClass: 'Beef', quantity: '50', uom: 'box' }]
    },
  };
  const context = {
    vckit: { vckitAPIUrl: 'https://example.com', issuer: 'did:web:example.com' },
    epcisAggregationEvent: {
      context: ['https://example.sh/AggregationEvent.jsonld'],
      type: ['AggregationEventCredential'],
      renderTemplate: [{ template: '<p>Render dpp template</p>', '@type': 'WebRenderingTemplate2022' }],
      dlrLinkTitle: 'Aggregation Event',
      dlrIdentificationKeyType: linkResolverService.IdentificationKeyType.gtin,
      dlrVerificationPage: 'http://exampleUI.com/verify',
      dlrQualifierPath: '',
    },
    dlr: { dlrAPIUrl: 'http://exampleDLR.com', dlrAPIKey: 'test-key' },
    storage: { storageAPIUrl: 'https://storage.dlr.com', bucket: 'agtrace-test-verifiable-credentials' },
    identifierKeyPaths: ['parentEPC', 'itemID'],
  };

  it('should process aggregation event', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
    (uploadJson as jest.Mock).mockImplementationOnce(() => uploadedAggregationEventLinkMock);
    jest
      .spyOn(validateContext, 'validateAggregationEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as Result<IAggregationEventContext>);
    jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(parentEPC);
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(aggregationEventDLRMock);

    const aggregationVC = await processAggregationEvent(aggregationEvent, context);

    expect(aggregationVC).toBe(aggregationVCMock);
    expect(uploadJson).toHaveBeenCalled();
    expect(validateContext.validateAggregationEventContext).toHaveBeenCalled();
    expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
    expect(linkResolverService.registerLinkResolver).toHaveBeenCalled();
  });

  it('should throw error if context validation throws an error', async () => {
    try {
      const invalidContext = {
        ...context,
        vckit: { vckitAPIUrl: 'invalid-url', issuer: 'invalid-issuer' }
      };
      jest
        .spyOn(validateContext, 'validateAggregationEventContext')
        .mockReturnValueOnce({ ok: false, value: 'Invalid context' });

      await processAggregationEvent(aggregationEvent, invalidContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid context');
    }
  });

  it('should throw error if identifier not found', async () => {
    try {
      const invalidIdentifierContent = {
        ...context,
        identifierKeyPaths: ['invalid']
      }
      jest
        .spyOn(validateContext, 'validateAggregationEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<IAggregationEventContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(undefined);

      await processAggregationEvent(aggregationEvent, invalidIdentifierContent);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Identifier not found');
      expect(validateContext.validateAggregationEventContext).toHaveBeenCalled();
    }
  });

  it('should throw error if issueVC throws an error', async () => {
    try {
      const invalidIssuerContext = {
        ...context,
        vckit: { ...context.vckit, issuer: 'invalid-issuer' }
      };
      jest
        .spyOn(validateContext, 'validateAggregationEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<IAggregationEventContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(parentEPC);
      jest.spyOn(publicAPI, 'post').mockRejectedValueOnce("Can't issue VC");

      await processAggregationEvent(aggregationEvent, invalidIssuerContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe("Can't issue VC");
      expect(validateContext.validateAggregationEventContext).toHaveBeenCalled();
      expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
    }
  });

  it('should throw error if uploadJson throws an error', async () => {
    try {
      const invalidStorageContext = {
        ...context,
        storage: { ...context.storage, storageAPIUrl: 'https://invalid-storage-provider.com' },
      };
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
      jest
        .spyOn(validateContext, 'validateAggregationEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<IAggregationEventContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(parentEPC);
      jest.spyOn(publicAPI, 'put').mockRejectedValueOnce('Invalid storage provider');

      await processAggregationEvent(aggregationEvent, invalidStorageContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid storage provider');
      expect(validateContext.validateAggregationEventContext).toHaveBeenCalled();
      expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
      expect(vckitService.issueVC).toHaveBeenCalled();
    }
  });

  it('should throw error if registerLinkResolver throws an error', async () => {
    try {
      const invalidDLRContext = {
        ...context,
        dlr: { ...context.dlr, dlrAPIUrl: 'http://invalid-dlr.com' },
      };
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
      (uploadJson as jest.Mock).mockImplementationOnce(() => uploadedAggregationEventLinkMock);
      jest
        .spyOn(validateContext, 'validateAggregationEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<IAggregationEventContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(parentEPC);
      jest.spyOn(linkResolverService, 'createLinkResolver').mockRejectedValueOnce('Invalid DLR API link resolver url');

      await processAggregationEvent(aggregationEvent, invalidDLRContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid DLR API link resolver url');
      expect(validateContext.validateAggregationEventContext).toHaveBeenCalled();
      expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
      expect(vckitService.issueVC).toHaveBeenCalled();
      expect(uploadJson).toHaveBeenCalled();
    }
  });
});
