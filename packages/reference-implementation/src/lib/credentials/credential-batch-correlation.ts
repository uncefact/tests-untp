/**
 * Derives an item id from the batch id, an underscore and the index. It is not
 * guaranteed to satisfy the shared validator's 128-character bound because the
 * batch id may be a full-length inbound header.
 */
export function credentialBatchItemCorrelationId(batchCorrelationId: string, index: number): string {
  return `${batchCorrelationId}_${index}`;
}
