import net from 'node:net';
import type { AddressInfo, Socket } from 'node:net';

export interface TcpRelay {
  /** The rig's `RI_DATABASE_URL`, pointed at the relay instead of the database. */
  readonly url: string;
  /** Destroys every socket and closes new connections on arrival until `restore()`. */
  cut(): void;
  /**
   * From now on, any connection whose client sends data goes silent: the data
   * is swallowed and nothing is forwarded or answered in either direction.
   * Established connections that carry no traffic are left alone.
   */
  stall(): void;
  /** Forwards new connections and traffic again. Sockets already silenced stay silent. */
  restore(): void;
  /** Destroys the silenced sockets on both sides, so operations waiting on them settle. */
  destroyStalled(): void;
  /** Destroys every socket and stops listening. */
  close(): Promise<void>;
}

interface Pair {
  client: Socket;
  upstream: Socket;
  silenced: boolean;
}

/**
 * Loopback TCP relay in front of the rig's database, so a suite can make the
 * database unreachable or unresponsive to the application's own Prisma client
 * without stopping the shared rig container. Point `RI_DATABASE_URL` at `url`
 * before the application's Prisma client is constructed.
 */
export async function startTcpRelay(): Promise<TcpRelay> {
  const source = process.env.RI_DATABASE_URL;
  if (!source) throw new Error('RI_DATABASE_URL is not set; the integration rig sets it in global setup');
  const target = new URL(source);
  const upstreamHost = target.hostname.replace(/^\[(.*)\]$/, '$1');
  const upstreamPort = Number(target.port || 5432);

  let mode: 'forward' | 'cut' | 'stall' = 'forward';
  const pairs = new Set<Pair>();

  const destroy = (pair: Pair): void => {
    pairs.delete(pair);
    pair.client.destroy();
    pair.upstream.destroy();
  };

  const server = net.createServer((client) => {
    // Resets are expected whenever a side is destroyed; they must not crash the suite.
    client.on('error', () => undefined);
    if (mode === 'cut') {
      client.destroy();
      return;
    }
    const upstream = net.connect(upstreamPort, upstreamHost);
    upstream.on('error', () => undefined);
    const pair: Pair = { client, upstream, silenced: false };
    pairs.add(pair);

    client.on('data', (chunk: Buffer) => {
      if (pair.silenced) return;
      if (mode === 'stall') {
        pair.silenced = true;
        return;
      }
      upstream.write(chunk);
    });
    upstream.on('data', (chunk: Buffer) => {
      if (!pair.silenced) client.write(chunk);
    });
    client.on('close', () => destroy(pair));
    // The database may drop an upstream that never completed its startup
    // (a stall swallowed it). Passing that close on would let the stranded
    // client operation settle, so a silenced pair waits for destroyStalled().
    upstream.on('close', () => {
      if (!pair.silenced) destroy(pair);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const url = new URL(source);
  url.hostname = '127.0.0.1';
  url.port = String(port);
  // Prisma lets a `host` parameter override the URL host, which would bypass the relay.
  if (url.searchParams.has('host')) url.searchParams.delete('host');

  return {
    url: url.toString(),
    cut: () => {
      mode = 'cut';
      for (const pair of pairs) destroy(pair);
    },
    stall: () => {
      mode = 'stall';
    },
    restore: () => {
      mode = 'forward';
    },
    destroyStalled: () => {
      for (const pair of pairs) if (pair.silenced) destroy(pair);
    },
    close: () => {
      mode = 'cut';
      for (const pair of pairs) destroy(pair);
      return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
