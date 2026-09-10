import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LookupAddress, LookupAllOptions } from 'node:dns';
import { resolveJsonDocument } from './resolve-json-document.js';

type RequestHandler = (request: IncomingMessage, response: ServerResponse) => void;

type LoopbackListener = {
  host: string;
  port: number;
  requests: string[];
  close: () => Promise<void>;
};

const listeners: LoopbackListener[] = [];

async function startListener(host: string, port: number, handler: RequestHandler): Promise<LoopbackListener> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? '');
    handler(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error(`Listener did not expose an address for ${host}`);
  }
  const { port: boundPort } = address as AddressInfo;
  const listener = {
    host,
    port: boundPort,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
  listeners.push(listener);
  return listener;
}

function jsonResponse(response: ServerResponse, value: Record<string, string>): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function address(host: string): LookupAddress {
  return { address: host, family: host.includes(':') ? 6 : 4 };
}

function controlledLookup(
  answers: LookupAddress[][],
  calls: string[],
): (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]> {
  return async (hostname, _options) => {
    calls.push(hostname);
    const answer = answers.shift();
    if (!answer) throw new Error(`Unexpected lookup for ${hostname}`);
    return answer;
  };
}

afterEach(async () => {
  await Promise.all(listeners.splice(0).map((listener) => listener.close()));
});

describe('resolveJsonDocument real socket pinning', () => {
  // Both listeners use loopback addresses. The explicit private-address
  // allowance is only for this local fixture; the callback's answers still
  // pass through the resolver's hostname and address guard.
  it('connects to the address validated first even when the next lookup answer changes', async () => {
    const listenerA = await startListener('127.0.0.1', 0, (_request, response) => {
      jsonResponse(response, { listener: 'A' });
    });
    const listenerB = await startListener('::1', listenerA.port, (_request, response) => {
      jsonResponse(response, { listener: 'B' });
    });
    const lookupCalls: string[] = [];
    const lookup = controlledLookup([[address(listenerA.host)], [address(listenerB.host)]], lookupCalls);

    const result = await resolveJsonDocument(`http://accepted.test:${listenerA.port}/document`, {
      allowPrivateAddresses: true,
      lookup,
    });

    expect(result.json).toEqual({ listener: 'A' });
    expect(listenerA.requests).toEqual(['/document']);
    expect(listenerB.requests).toEqual([]);
    expect(lookupCalls).toEqual(['accepted.test']);
  });

  it('re-validates and re-pins a redirect hop to the second listener', async () => {
    let redirectLocation = '';
    const listenerA = await startListener('127.0.0.1', 0, (_request, response) => {
      response.writeHead(302, { location: redirectLocation });
      response.end();
    });
    const listenerB = await startListener('::1', listenerA.port, (_request, response) => {
      jsonResponse(response, { listener: 'B' });
    });
    redirectLocation = `http://redirect-target.test:${listenerA.port}/final`;
    const lookupCalls: string[] = [];
    const lookup = controlledLookup([[address(listenerA.host)], [address(listenerB.host)]], lookupCalls);

    const result = await resolveJsonDocument(`http://redirect-source.test:${listenerA.port}/start`, {
      allowPrivateAddresses: true,
      lookup,
    });

    expect(result.json).toEqual({ listener: 'B' });
    expect(listenerA.requests).toEqual(['/start']);
    expect(listenerB.requests).toEqual(['/final']);
    expect(lookupCalls).toEqual(['redirect-source.test', 'redirect-target.test']);
  });

  it('tries the second validated address when the first address refuses the connection', async () => {
    const listenerB = await startListener('127.0.0.1', 0, (_request, response) => {
      jsonResponse(response, { listener: 'B' });
    });
    const refusedAddress = '::1';
    const lookupCalls: string[] = [];
    const lookup = controlledLookup([[address(refusedAddress), address(listenerB.host)]], lookupCalls);

    const result = await resolveJsonDocument(`http://failover.test:${listenerB.port}/document`, {
      allowPrivateAddresses: true,
      lookup,
    });

    expect(result.json).toEqual({ listener: 'B' });
    expect(listenerB.requests).toEqual(['/document']);
    expect(lookupCalls).toEqual(['failover.test']);
  });
});
