import { isValidCorrelationId } from '@uncefact/untp-ri-services/logging';
import { credentialBatchItemCorrelationId } from './credential-batch-correlation';

it('derives an item id that distinguishes an item from its batch', () => {
  // Regression: a normal batch id must still produce the item context accepted by withTenantAuth.
  const itemCorrelationId = credentialBatchItemCorrelationId('abc123', 17);

  expect(itemCorrelationId).toBe('abc123_17');
  expect(isValidCorrelationId(itemCorrelationId)).toBe(true);
});
