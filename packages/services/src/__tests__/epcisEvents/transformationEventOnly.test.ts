import { ITraceabilityEvent } from '../../types';
import { processTransformationEventOnly } from '../../epcisEvents/transformationEventOnly';
import * as vckitService from '../../vckit.service';
import { uploadData } from '../../storage.service';
import * as linkResolverService from '../../linkResolver.service';
import * as identifierSchemeServices from '../../identifierSchemes/identifierSchemeServices';
import { ITraceabilityEventContext } from '../../types';
import { Result } from '../../types/validateContext';
import * as validateContext from '../../validateContext';
import { traceabilityEventContext as context } from '../mocks/constants';

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
  IdentificationKeyType: jest.fn(),
  LinkType: {
    verificationLinkType: 'verificationService',
    certificationLinkType: 'certificationInfo',
    epcisLinkType: 'epcis',
  },
}));

describe('processTransformationEventOnly', () => {
  const transformationEvent: ITraceabilityEvent = {
    data: [
      {
        type: ['TransformationEvent', 'Event'],
        id: '010501234567890021951350380',
        processType: 'Weaving',
        eventTime: '2024-09-01T12:00:00',
        action: 'Add',
        disposition: 'https://ref.gs1.org/cbv/Disp-active',
        bizStep: 'https://ref.gs1.org/cbv/BizStep-commissioning',
        bizLocation: 'https://id.gs1.org/414/9520123456788',
        sensorElementList: [
          {
            sensorMetadata: {
              device: {
                type: ['Item'],
                id: 'https://id.gs1.org/01/09520123456788/21/12345',
                name: 'EV battery 300Ah.',
              },
              dataProcessingMethod: 'https://standards.org/sensorMethod#1234',
            },
            sensorReport: [
              {
                time: '2024-07-24T12:00:00',
                sensorType: 'https://samplesensors.com/model1234',
                value: 25,
                uom: 'KGM',
              },
              {
                time: '2024-07-24T12:00:00',
                sensorType: 'https://samplesensors.com/model1234',
                value: 25,
                uom: 'KGM',
              },
            ],
            sensorIntegrityProof: 'https://jargon.sh',
          },
          {
            sensorMetadata: {
              device: {
                type: ['Item'],
                id: 'https://id.gs1.org/01/09520123456788/21/12345',
                name: 'EV battery 300Ah.',
              },
              dataProcessingMethod: 'https://standards.org/sensorMethod#1234',
            },
            sensorReport: [
              {
                time: '2024-07-24T12:00:00',
                sensorType: 'https://samplesensors.com/model1234',
                value: 25,
                uom: 'KGM',
              },
              {
                time: '2024-07-24T12:00:00',
                sensorType: 'https://samplesensors.com/model1234',
                value: 25,
                uom: 'KGM',
              },
            ],
            sensorIntegrityProof: 'https://jargon.sh',
          },
        ],
        outputEPCList: [
          {
            type: ['Item'],
            id: 'https://id.gs1.org/01/09520123456788/21/12345',
            name: 'EV battery 300Ah.',
          },
          {
            type: ['Item'],
            id: 'https://id.gs1.org/01/09520123456788/21/12345',
            name: 'EV battery 300Ah.',
          },
        ],
        inputEPCList: [
          {
            type: ['Item'],
            id: 'https://id.gs1.org/01/09520123456788/21/12345',
            name: 'EV battery 300Ah.',
          },
          {
            type: ['Item'],
            id: 'https://id.gs1.org/01/09520123456788/21/12345',
            name: 'EV battery 300Ah.',
          },
        ],
        inputQuantityList: [
          {
            productId: 'https://id.gs1.org/01/09520123456788/21/12345',
            productName: 'EV battery 300Ah.',
            quantity: 20,
            uom: 'KGM',
          },
          {
            productId: 'https://id.gs1.org/01/09520123456788/21/12345',
            productName: 'EV battery 300Ah.',
            quantity: 20,
            uom: 'KGM',
          },
        ],
        outputQuantityList: [
          {
            productId: 'https://id.gs1.org/01/09520123456788/21/12345',
            productName: 'EV battery 300Ah.',
            quantity: 20,
            uom: 'KGM',
          },
          {
            productId: 'https://id.gs1.org/01/09520123456788/21/12345',
            productName: 'EV battery 300Ah.',
            quantity: 20,
            uom: 'KGM',
          },
        ],
      },
    ],
  };

  it('should process transformation event successfully', async () => {
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

    const result = await processTransformationEventOnly(transformationEvent, context);

    expect(result.vc).toEqual({ credentialSubject: { id: 'https://example.com/123' } });
    expect(result.linkResolver).toEqual('https://example.com/link-resolver');
  });

  it('should throw error when context validation false', async () => {
    const invalidContext: any = { ...context };
    delete invalidContext.traceabilityEvent;

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: false, value: 'Invalid context' });

    expect(async () => await processTransformationEventOnly(transformationEvent, invalidContext)).rejects.toThrow(
      'Invalid context',
    );
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

    expect(
      async () => await processTransformationEventOnly(transformationEvent, invalidIdentifierContent),
    ).rejects.toThrow('Identifier not found');
  });

  it('should throw error when TransformationEvent data not found', async () => {
    const invalidTransformationEvent = {
      ...transformationEvent,
      data: undefined,
    };

    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as unknown as Result<ITraceabilityEventContext>);

    expect(async () => await processTransformationEventOnly(invalidTransformationEvent, context)).rejects.toThrow(
      'Transformation event data not found',
    );
  });

  it('should process transformation event with custom verifiable credential service headers', async () => {
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

    await processTransformationEventOnly(transformationEvent, contextWithHeaders);

    expect(vckitService.issueVC).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: mockHeaders,
      }),
    );
  });
});
