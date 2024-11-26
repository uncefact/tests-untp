import * as vckitService from '../vckit.service';
import { uploadData } from '../storage.service';
import * as linkResolverService from '../linkResolver.service';
import * as identifierSchemeServices from '../identifierSchemes/identifierSchemeServices';
import { ITraceabilityEventContext } from '../types/types';
import { Result } from '../types/validateContext';
import * as validateContext from '../validateContext';
import { processAggregationEvent } from '../epcisEvents';
import { publicAPI } from '../utils/httpService';
import { aggregationEventMock } from './mocks/constants';

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
    (uploadData as jest.Mock).mockResolvedValueOnce(aggregationEventDLRMock);

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '01', value: '0123456789' },
      qualifiers: [
        { ai: '21', value: '951350380' },
        { ai: '10', value: 'ABC123' },
      ],
    });
    jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/21/951350380/10/ABC123');

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
      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '01', value: '0123456789' },
        qualifiers: [
          { ai: '21', value: '951350380' },
          { ai: '10', value: 'ABC123' },
        ],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/21/951350380/10/ABC123');
      jest.spyOn(publicAPI, 'post').mockRejectedValueOnce("Can't issue VC");

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

      jest
        .spyOn(validateContext, 'validateTraceabilityEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '01', value: '0123456789' },
        qualifiers: [
          { ai: '21', value: '951350380' },
          { ai: '10', value: 'ABC123' },
        ],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/21/951350380/10/ABC123');
      jest.spyOn(publicAPI, 'put').mockRejectedValueOnce('Invalid storage provider');

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

      (uploadData as jest.Mock).mockImplementation(({ url, _data, path }) => {
        return `${url}/${path}`;
      });

      jest
        .spyOn(validateContext, 'validateTraceabilityEventContext')
        .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);
      jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
        primary: { ai: '01', value: '0123456789' },
        qualifiers: [
          { ai: '21', value: '951350380' },
          { ai: '10', value: 'ABC123' },
        ],
      });
      jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/21/951350380/10/ABC123');
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
    (uploadData as jest.Mock).mockResolvedValueOnce('https://exampleStorage.com/vc.json');

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: contextWithHeaders } as unknown as Result<ITraceabilityEventContext>);
    jest.spyOn(linkResolverService, 'registerLinkResolver').mockResolvedValueOnce(aggregationEventDLRMock);

    jest.spyOn(identifierSchemeServices, 'constructIdentifierData').mockReturnValue({
      primary: { ai: '01', value: '0123456789' },
      qualifiers: [
        { ai: '21', value: '951350380' },
        { ai: '10', value: 'ABC123' },
      ],
    });
    jest.spyOn(identifierSchemeServices, 'constructQualifierPath').mockReturnValue('/21/951350380/10/ABC123');

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
