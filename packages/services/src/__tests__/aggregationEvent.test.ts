import * as vckitService from '../vckit.service';
import { getStorageServiceLink } from '../storage.service';
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
  getStorageServiceLink: jest.fn(),
}));
jest.mock('../linkResolver.service', () => ({
  registerLinkResolver: jest.fn(),
  createLinkResolver: jest.fn(),
  IdentificationKeyType: jest.fn(),
}));

describe('processAggregationEvent', () => {
  const { gtinMock, aggregationVCMock, aggregationEventDLRMock } =
    aggregationEventMock;
  const aggregationEvent = {
    data: {
      parentItem: { itemID: gtinMock, name: 'Beef Variety Container' },
      childItems: [{ itemID: 'http://example.com/beef-scotch-box.json', name: 'Beef Scotch Fillet Box' }],
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
    storage: { url: 'https://exampleStorage.com'},
    identifierKeyPaths: ['parentItem', 'itemID'],
  };

  it('should process aggregation event', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
    (getStorageServiceLink as jest.Mock).mockResolvedValueOnce('https://exampleStorage.com/vc.json');

    jest
      .spyOn(validateContext, 'validateAggregationEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as Result<IAggregationEventContext>);
    jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(gtinMock);
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(aggregationEventDLRMock);

    const aggregationVC = await processAggregationEvent(aggregationEvent, context);

    expect(aggregationVC).toBe(aggregationVCMock);
    expect(getStorageServiceLink).toHaveBeenCalled();
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
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(gtinMock);
      jest.spyOn(publicAPI, 'post').mockRejectedValueOnce("Can't issue VC");

      await processAggregationEvent(aggregationEvent, invalidIssuerContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe("Can't issue VC");
      expect(validateContext.validateAggregationEventContext).toHaveBeenCalled();
      expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
    }
  });

  it('should throw error if storage service throws an error', async () => {
    try {
      const invalidStorageContext = {
        ...context,
        storage: { ...context.storage, storageAPIUrl: 'https://invalid-storage-provider.com' },
      };
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
      jest
        .spyOn(validateContext, 'validateAggregationEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<IAggregationEventContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(gtinMock);
      jest.spyOn(publicAPI, 'post').mockRejectedValueOnce('Invalid storage provider');
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
      (getStorageServiceLink as jest.Mock).mockImplementation(({ url, _data, path }) => {
        return `${url}/${path}`;
      });
      jest
        .spyOn(validateContext, 'validateAggregationEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as Result<IAggregationEventContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(gtinMock);
      jest.spyOn(linkResolverService, 'createLinkResolver').mockRejectedValueOnce('Invalid DLR API link resolver url');

      await processAggregationEvent(aggregationEvent, invalidDLRContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid DLR API link resolver url');
      expect(validateContext.validateAggregationEventContext).toHaveBeenCalled();
      expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
      expect(vckitService.issueVC).toHaveBeenCalled();
      expect(getStorageServiceLink).toHaveBeenCalled();
    }
  });
});
