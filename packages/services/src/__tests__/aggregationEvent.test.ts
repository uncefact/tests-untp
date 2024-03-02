import * as vckitService from '../vckit.service';
import { uploadJson } from '../storage.service';
import * as linkResolverService from '../linkResolver.service';
import { IContext } from '../epcisEvents/types';
import { Result } from '../types/validateContext';
import * as validateContext from '../epcisEvents/validateContext';
import * as helpers from '../epcisEvents/helpers';
import { processAggregationEvent } from '../epcisEvents';
import { publicAPI } from '../utils/httpService';

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

const nlisidMock = '9988776600000';
const uploadedAggregationEventLinkMock = `https://s3.ap-southeast-2.amazonaws.com/${nlisidMock}`;
const aggregationEventDLRMock = `https://example.com/nlisid/${nlisidMock}?linkType=all`;
const aggregationVCMock = {
  '@context': ['https://example.sh/AggregationEvent.jsonld'],
  type: ['VerifiableCredential', 'AggregationEventCredential'],
  issuer: 'did:web:example.com',
  credentialSubject: {
    parentItem: { itemID: aggregationEventDLRMock, name: 'Beef Steak Variety Container' },
    childItems: [{ itemID: 'http://example.com/beef-scotch-box.json', name: 'Beef Scotch Fillet Box' }],
    childQuantityList: [{ productClass: 'Beef', quantity: '50', uom: 'units' }],
    locationId: 'https://plus.codes/123MHR+PW',
  },
};

describe('processAggregationEvent', () => {
  const aggregationEvent = {
    data: {
      parentItem: { itemID: nlisidMock, name: 'Beef Steak Variety Container' },
      childItems: [{ itemID: 'http://example.com/beef-scotch-box.json', name: 'Beef Scotch Fillet Box' }],
      childQuantityList: [{ productClass: 'Beef', quantity: '50', uom: 'units' }],
      locationId: 'https://plus.codes/123MHR+PW',
    },
  };
  const context = {
    vckit: { vckitAPIUrl: 'https://example.com', issuer: 'did:web:example.com' },
    dpp: {
      context: ['https://example.sh/AggregationEvent.jsonld'],
      type: ['AggregationEventCredential'],
      renderTemplate: [{ template: '<p>Render dpp template</p>', '@type': 'WebRenderingTemplate2022' }],
      dlrLinkTitle: 'Aggregation Event',
      dlrIdentificationKeyType: linkResolverService.IdentificationKeyType.nlisid,
      dlrVerificationPage: 'http://exampleUI:.com/verify',
      dlrQualifierPath: '',
    },
    dlr: { dlrAPIUrl: 'http://exampleDLR.com', dlrAPIKey: 'test-key' },
    storage: { storageAPIUrl: 'https://storage.dlr.com', bucket: 'agtrace-test-verifiable-credentials' },
    identifierKeyPaths: ['parentItem', 'itemID'],
  };

  it('should process aggregation event', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
    (uploadJson as jest.Mock).mockImplementationOnce(() => uploadedAggregationEventLinkMock);
    jest
      .spyOn(validateContext, 'validateContextObjectEvent')
      .mockReturnValueOnce({ ok: true, value: context } as Result<IContext>);
    jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(nlisidMock);
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(aggregationEventDLRMock);

    const aggregationVC = await processAggregationEvent(aggregationEvent, context);

    expect(aggregationVC).toBe(aggregationVCMock);
    expect(uploadJson).toHaveBeenCalled();
    expect(validateContext.validateContextObjectEvent).toHaveBeenCalled();
    expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
    expect(linkResolverService.registerLinkResolver).toHaveBeenCalled();
  });

  it('Should throw error if context validation throws an error', async () => {
    try {
      jest
        .spyOn(validateContext, 'validateContextObjectEvent')
        .mockReturnValueOnce({ ok: false, value: 'Invalid context' });

      await processAggregationEvent(aggregationEvent, context);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid context');
    }
  });

  it('Should throw error if identifier not found', async () => {
    try {
      jest
        .spyOn(validateContext, 'validateContextObjectEvent')
        .mockReturnValueOnce({ ok: true, value: context } as Result<IContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(undefined);

      await processAggregationEvent(aggregationEvent, context);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Identifier not found');
      expect(validateContext.validateContextObjectEvent).toHaveBeenCalled();
    }
  });

  it('Should throw error if issueVC throws an error', async () => {
    try {
      jest
        .spyOn(validateContext, 'validateContextObjectEvent')
        .mockReturnValueOnce({ ok: true, value: context } as Result<IContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(nlisidMock);
      jest.spyOn(publicAPI, 'post').mockRejectedValueOnce("Can't issue VC");

      await processAggregationEvent(aggregationEvent, context);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe("Can't issue VC");
      expect(validateContext.validateContextObjectEvent).toHaveBeenCalled();
      expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
    }
  });

  it('Should throw error if uploadJson throws an error', async () => {
    try {
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
      jest
        .spyOn(validateContext, 'validateContextObjectEvent')
        .mockReturnValueOnce({ ok: true, value: context } as Result<IContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(nlisidMock);
      jest.spyOn(publicAPI, 'put').mockRejectedValueOnce('Error upload json');

      await processAggregationEvent(aggregationEvent, context);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Error upload json');
      expect(validateContext.validateContextObjectEvent).toHaveBeenCalled();
      expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
      expect(vckitService.issueVC).toHaveBeenCalled();
    }
  });

  it('Should throw error if registerLinkResolver throws an error', async () => {
    try {
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
      (uploadJson as jest.Mock).mockImplementationOnce(() => uploadedAggregationEventLinkMock);
      jest
        .spyOn(validateContext, 'validateContextObjectEvent')
        .mockReturnValueOnce({ ok: true, value: context } as Result<IContext>);
      jest.spyOn(helpers, 'getIdentifierByObjectKeyPaths').mockReturnValueOnce(nlisidMock);
      jest.spyOn(linkResolverService, 'createLinkResolver').mockRejectedValueOnce('Error creating link resolver');

      await processAggregationEvent(aggregationEvent, context);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Error creating link resolver');
      expect(validateContext.validateContextObjectEvent).toHaveBeenCalled();
      expect(helpers.getIdentifierByObjectKeyPaths).toHaveBeenCalled();
      expect(vckitService.issueVC).toHaveBeenCalled();
      expect(uploadJson).toHaveBeenCalled();
    }
  });
});
