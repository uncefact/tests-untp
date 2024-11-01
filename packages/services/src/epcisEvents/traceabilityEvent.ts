import JSONPointer from 'jsonpointer';
import { ITraceabilityEvent } from '../types';
import { IService } from '../types/IService.js';
import { validateTraceabilityEventContext } from '../validateContext.js';
import { processAssociationEvent } from './associationEvent.js';
import { processObjectEvent } from './objectEvent.js';
import { processTransactionEvent } from './transactionEvent.js';
import { processAggregationEvent } from './aggregationEvent.js';
import { processTransformationEventOnly } from './transformationEventOnly.js';

export const processTraceabilityEvent: IService = async (
  traceabilityEvent: ITraceabilityEvent,
  context: any,
): Promise<any> => {
  const validationResult = validateTraceabilityEventContext(context);
  if (!validationResult.ok) {
    throw new Error(validationResult.value);
  }

  if (!traceabilityEvent.data || (traceabilityEvent.data as Record<string, any>[]).length === 0) {
    throw new Error('Traceability event data not found');
  }

  if (traceabilityEvent.data.length > 1) {
    throw new Error('Traceability event data must be a single object');
  }
  const eventType: string = JSONPointer.get(traceabilityEvent.data, context.eventTypePath);
  switch (eventType) {
    case 'AssociationEvent':
      return processAssociationEvent(traceabilityEvent, context);
    case 'ObjectEvent':
      return processObjectEvent(traceabilityEvent, context);
    case 'TransactionEvent':
      return processTransactionEvent(traceabilityEvent, context);
    case 'AggregationEvent':
      return processAggregationEvent(traceabilityEvent, context);
    case 'TransformationEvent':
      return processTransformationEventOnly(traceabilityEvent, context);
    default:
      throw new Error(`Unknown event type: ${eventType}`);
  }
};
