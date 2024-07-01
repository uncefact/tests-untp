import { IncomingMessage } from 'http';

/**
 * Reads a stream and returns the parsed JSON object.
 *
 * @param stream - The incoming message stream.
 * @returns A promise that resolves to the parsed JSON object.
 */
export default async function receiveJson(stream: IncomingMessage): Promise<any> {
  const bufs: Buffer[] = [];
  
  // Collect the stream data
  await new Promise<void>((resolve, reject) => {
    stream.on('error', reject);
    stream.on('data', (chunk: Buffer) => bufs.push(chunk));
    stream.on('end', resolve);
  });

  // Concatenate all buffers and parse the resulting JSON
  const buf = Buffer.concat(bufs);
  return JSON.parse(buf.toString());
}
