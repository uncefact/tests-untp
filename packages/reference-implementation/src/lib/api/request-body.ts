import { PayloadTooLargeError, RequestBodyUnreadableError } from '@/lib/api/errors';
import { readMaxRequestBodyBytes } from '@/lib/config/request-body-limit.config';

export function requestBodyTooLargeMessage(maxBytes: number): string {
  return `The request body exceeds the maximum of ${maxBytes} bytes.`;
}

function throwRequestBodyTooLarge(maxBytes: number): never {
  throw new PayloadTooLargeError(requestBodyTooLargeMessage(maxBytes), 'REQUEST_BODY_TOO_LARGE');
}

/**
 * Reads the raw request bytes, bounded by `MAX_REQUEST_BODY_BYTES`. A
 * `Content-Length` that already exceeds the cap is rejected before any
 * bytes are buffered. Otherwise the body is read in chunks and rejected as
 * soon as the accumulated length exceeds the cap, so a lying or absent
 * `Content-Length` still cannot make the process hold more than one chunk
 * beyond the bound. A request with no body yields an empty byte array.
 */
export async function readRequestBytes(req: Request): Promise<Uint8Array> {
  const maxBytes = readMaxRequestBodyBytes();
  const contentLengthHeader = req.headers.get('content-length');
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throwRequestBodyTooLarge(maxBytes);
    }
  }

  if (req.body == null) {
    return new Uint8Array(0);
  }

  try {
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // The size rejection is what the caller acts on.
        }
        throwRequestBodyTooLarge(maxBytes);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  } catch (error) {
    if (error instanceof PayloadTooLargeError) throw error;
    throw new RequestBodyUnreadableError();
  }
}
