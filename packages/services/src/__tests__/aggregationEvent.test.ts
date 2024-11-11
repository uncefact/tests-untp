import * as vckitService from '../vckit.service';
import { uploadData } from '../storage.service';
import * as linkResolverService from '../linkResolver.service';
import { ITraceabilityEventContext } from '../types/types';
import { Result } from '../types/validateContext';
import * as validateContext from '../validateContext';
import { processAggregationEvent } from '../epcisEvents';
import { aggregationEventMock } from './mocks/constants';
import { constructVerifyURL } from '../utils/helpers';
import { issueVC } from '../vckit.service';

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
  IdentificationKeyType: jest.fn(),
  getLinkResolverIdentifier: jest.fn(),
  getLinkResolverIdentifierFromURI: jest.fn(),
  LinkType: {
    verificationLinkType: 'gs1:verificationService',
    certificationLinkType: 'gs1:certificationInfo',
    epcisLinkType: 'gs1:epcis',
  },
}));
jest.mock('../utils/helpers', () => ({
  ...jest.requireActual('../utils/helpers'),
  constructVerifyURL: jest.fn(),
}));

describe('processAggregationEvent', () => {
  const { parentItem, aggregationVCMock, uploadedAggregationEventLinkMock, aggregationEventDLRMock } =
    aggregationEventMock;
  const aggregationEvent = {
    data: [
      {
        parentItem: { itemID: [{ ai: '01', value: '09359502000010' }], name: 'Beef Variety Container' },
        childItems: [{ itemID: 'http://example.com/beef-scotch-box.json', name: 'Beef Scotch Fillet Box' }],
        childQuantityList: [{ productClass: 'Beef', quantity: '50', uom: 'box' }],
      },
    ],
  };
  const context = {
    vckit: { vckitAPIUrl: 'https://example.com', issuer: 'did:web:example.com' },
    traceabilityEvent: {
      context: ['https://example.sh/AggregationEvent.jsonld'],
      type: ['AggregationEventCredential'],
      renderTemplate: [{ template: '<p>Render dpp template</p>', '@type': 'WebRenderingTemplate2022' }],
      dlrLinkTitle: 'Aggregation Event',
      dlrIdentificationKeyType: linkResolverService.IdentificationKeyType.gtin,
      dlrVerificationPage: 'http://exampleUI.com/verify',
      dlrQualifierPath: '',
    },
    dlr: { dlrAPIUrl: 'http://exampleDLR.com', dlrAPIKey: 'test-key' },
    storage: { url: 'https://exampleStorage.com' },
    identifierKeyPath: '/0/parentItem/itemID',
  };

  it('should process aggregation event', async () => {
    (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
    (vckitService.decodeEnvelopedVC as jest.Mock).mockReturnValue(aggregationVCMock);
    (uploadData as jest.Mock).mockResolvedValueOnce({ uri: 'https://exampleStorage.com/vc.json', key: '123', hash: 'ABC123' });
    (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
    jest
      .spyOn(linkResolverService, 'getLinkResolverIdentifier')
      .mockReturnValueOnce({ identifier: '0123456789', qualifierPath: '/10/ABC123' });
    jest.spyOn(linkResolverService, 'getLinkResolverIdentifierFromURI').mockReturnValueOnce({
      identifier: '0123456789',
      qualifierPath: '/10/ABC123',
      elementString: '01012345678910ABC123',
    });

    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(aggregationEventDLRMock);
    const aggregationVC = await processAggregationEvent(aggregationEvent, context);

    expect(aggregationVC).toEqual({
      vc: aggregationVCMock,
      decodedEnvelopedVC: aggregationVCMock,
      linkResolver: aggregationEventDLRMock,
    });
    expect(uploadData).toHaveBeenCalled();
    expect(validateContext.validateTraceabilityEventContext).toHaveBeenCalled();
    expect(linkResolverService.registerLinkResolver).toHaveBeenCalled();
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
        identifierKeyPath: '/invalid',
      };
      jest
        .spyOn(validateContext, 'validateTraceabilityEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);

      await processAggregationEvent(aggregationEvent, invalidIdentifierContent);
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
      jest
        .spyOn(validateContext, 'validateTraceabilityEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
      jest
        .spyOn(linkResolverService, 'getLinkResolverIdentifier')
        .mockReturnValueOnce({ identifier: '0123456789', qualifierPath: '/10/ABC123' });
      jest.spyOn(linkResolverService, 'getLinkResolverIdentifierFromURI').mockReturnValueOnce({
        identifier: '0123456789',
        qualifierPath: '/10/ABC123',
        elementString: '01012345678910ABC123',
      });
      (issueVC as jest.Mock).mockRejectedValueOnce(new Error("Can't issue VC"));

      await processAggregationEvent(aggregationEvent, invalidIssuerContext);
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
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
      (vckitService.decodeEnvelopedVC as jest.Mock).mockReturnValue(aggregationVCMock);
      (uploadData as jest.Mock).mockRejectedValueOnce(new Error('Invalid storage provider'));

      jest
        .spyOn(validateContext, 'validateTraceabilityEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
      jest
        .spyOn(linkResolverService, 'getLinkResolverIdentifier')
        .mockReturnValueOnce({ identifier: '0123456789', qualifierPath: '/10/ABC123' });
      jest.spyOn(linkResolverService, 'getLinkResolverIdentifierFromURI').mockReturnValueOnce({
        identifier: '0123456789',
        qualifierPath: '/10/ABC123',
        elementString: '01012345678910ABC123',
      });

      await processAggregationEvent(aggregationEvent, invalidStorageContext);
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
      (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
      (vckitService.decodeEnvelopedVC as jest.Mock).mockReturnValue(aggregationVCMock);

      (uploadData as jest.Mock).mockResolvedValueOnce({ uri: 'https://exampleStorage.com/vc.json', key: '123', hash: 'ABC123' });
      (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');

      jest
        .spyOn(validateContext, 'validateTraceabilityEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
      jest
        .spyOn(linkResolverService, 'getLinkResolverIdentifier')
        .mockReturnValueOnce({ identifier: '0123456789', qualifierPath: '/10/ABC123' });
      jest.spyOn(linkResolverService, 'getLinkResolverIdentifierFromURI').mockReturnValueOnce({
        identifier: '0123456789',
        qualifierPath: '/10/ABC123',
        elementString: '01012345678910ABC123',
      });
      jest.spyOn(linkResolverService, 'createLinkResolver').mockRejectedValueOnce('Invalid DLR API link resolver url');

      await processAggregationEvent(aggregationEvent, invalidDLRContext);
    } catch (e) {
      const error = e as Error;
      expect(error.message).toBe('Invalid DLR API link resolver url');
      expect(validateContext.validateTraceabilityEventContext).toHaveBeenCalled();
      expect(vckitService.issueVC).toHaveBeenCalled();
      expect(uploadData).toHaveBeenCalled();
    }
  });

  it('should process aggregation event with custom verifiable credential service headers', async () => {
    const customHeaders = { 'X-Custom-Header': 'test-value' };
    const contextWithHeaders = {
      ...context,
      vckit: { ...context.vckit, headers: customHeaders },
    };

    (vckitService.issueVC as jest.Mock).mockImplementationOnce(() => aggregationVCMock);
    (uploadData as jest.Mock).mockResolvedValueOnce({ uri: 'https://exampleStorage.com/vc.json', key: '123', hash: 'ABC123' });
    (constructVerifyURL as jest.Mock).mockReturnValueOnce('http://localhost/event/1234');

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: contextWithHeaders } as unknown as Result<ITraceabilityEventContext>);
    jest
      .spyOn(linkResolverService, 'getLinkResolverIdentifier')
      .mockReturnValueOnce({ identifier: '0123456789', qualifierPath: '/10/ABC123' });
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(aggregationEventDLRMock);
    jest.spyOn(linkResolverService, 'getLinkResolverIdentifierFromURI').mockReturnValueOnce({
      identifier: '0123456789',
      qualifierPath: '/10/ABC123',
      elementString: '01012345678910ABC123',
    });

    const aggregationVC = await processAggregationEvent(aggregationEvent, contextWithHeaders);

    expect(aggregationVC).toEqual({
      vc: aggregationVCMock,
      decodedEnvelopedVC: aggregationVCMock,
      linkResolver: aggregationEventDLRMock,
    });
    expect(vckitService.issueVC).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: customHeaders,
      }),
    );
    expect(uploadData).toHaveBeenCalled();
    expect(validateContext.validateTraceabilityEventContext).toHaveBeenCalled();
    expect(linkResolverService.registerLinkResolver).toHaveBeenCalled();
  });
});
