import * as validateContext from '../../validateContext';
import { processTraceabilityEvent } from '../../epcisEvents/traceabilityEvent';
import { processAssociationEvent } from '../../epcisEvents/associationEvent';
import { ITraceabilityEventContext } from '../../types';

jest.mock('../../epcisEvents/associationEvent', () => ({
  processAssociationEvent: jest.fn(),
}));
jest.mock('../../epcisEvents/objectEvent', () => ({
  processObjectEvent: jest.fn(),
}));
jest.mock('../../epcisEvents/transactionEvent', () => ({
  processTransactionEvent: jest.fn(),
}));
jest.mock('../../epcisEvents/aggregationEvent', () => ({
  processAggregationEvent: jest.fn(),
}));
jest.mock('../../epcisEvents/transformationEventOnly', () => ({
  processTransformationEventOnly: jest.fn(),
}));

describe('processTraceabilityEvent', () => {
  it('should call processAssociationEvent when eventType is AssociationEvent', async () => {
    const traceabilityEvent = {
      data: [{ type: ['AssociationEvent', 'Event'] }],
    };
    const context = {
      eventTypePath: '/0/type/0',
    };
    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as any);

    await processTraceabilityEvent(traceabilityEvent, context);

    expect(processAssociationEvent).toHaveBeenCalled();
  });

  it('should call processObjectEvent when eventType is ObjectEvent', async () => {
    const traceabilityEvent = {
      data: [{ type: ['ObjectEvent', 'Event'] }],
    };
    const context = {
      eventTypePath: '/0/type/0',
    };
    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as any);

    await processTraceabilityEvent(traceabilityEvent, context);

    expect(processAssociationEvent).toHaveBeenCalled();
  });

  it('should call processTransactionEvent when eventType is TransactionEvent', async () => {
    const traceabilityEvent = {
      data: [{ type: ['TransactionEvent', 'Event'] }],
    };
    const context = {
      eventTypePath: '/0/type/0',
    };
    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as any);

    await processTraceabilityEvent(traceabilityEvent, context);

    expect(processAssociationEvent).toHaveBeenCalled();
  });

  it('should call processAggregationEvent when eventType is AggregationEvent', async () => {
    const traceabilityEvent = {
      data: [{ type: ['AggregationEvent', 'Event'] }],
    };
    const context = {
      eventTypePath: '/0/type/0',
    };
    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as any);

    await processTraceabilityEvent(traceabilityEvent, context);

    expect(processAssociationEvent).toHaveBeenCalled();
  });

  it('should call processTransformationEventOnly when eventType is TransformationEvent', async () => {
    const traceabilityEvent = {
      data: [{ type: ['TransformationEvent', 'Event'] }],
    };
    const context = {
      eventTypePath: '/0/type/0',
    };
    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as any);

    await processTraceabilityEvent(traceabilityEvent, context);

    expect(processAssociationEvent).toHaveBeenCalled();
  });

  it('should throw error when eventType is unknown', async () => {
    const traceabilityEvent = {
      data: [{ type: ['UnknownEvent', 'Event'] }],
    };
    const context = {
      eventTypePath: '/0/type/0',
    };
    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as any);

    expect(async () => await processTraceabilityEvent(traceabilityEvent, context)).rejects.toThrow(
      'Unknown event type: UnknownEvent',
    );
  });

  it('should throw error when context validation false', async () => {
    const traceabilityEvent = {
      data: [{ type: ['AssociationEvent', 'Event'] }],
    };
    const context = {
      eventTypePath: '/0/type/0',
    };
    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: false, value: 'Invalid context' });

    expect(async () => await processTraceabilityEvent(traceabilityEvent, context)).rejects.toThrow('Invalid context');
  });

  it('should throw error when traceabilityEvent data not found', async () => {
    const traceabilityEvent = {
      data: [],
    };
    const context = {
      eventTypePath: '/0/type/0',
    };
    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as any);

    expect(async () => await processTraceabilityEvent(traceabilityEvent, context)).rejects.toThrow(
      'Traceability event data not found',
    );
  });

  it('should throw error when traceabilityEvent data is not a single object', async () => {
    const traceabilityEvent = {
      data: [{ type: ['AssociationEvent', 'Event'] }, { type: ['ObjectEvent', 'Event'] }],
    };
    const context = {
      eventTypePath: '/0/type/0',
    };
    jest
      .spyOn(validateContext, 'validateTraceabilityEventContext')
      .mockReturnValueOnce({ ok: true, value: context } as any);

    expect(async () => await processTraceabilityEvent(traceabilityEvent, context)).rejects.toThrow(
      'Traceability event data must be a single object',
    );
  });
});
