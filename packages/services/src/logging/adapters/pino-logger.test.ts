import pino from 'pino';
import * as requestContext from '../request-context.js';
import { runWithRequestContext, updateRequestContext } from '../request-context.js';
import { PinoLoggerAdapter } from './pino-logger.js';

function createCapture(): {
  destination: { write: (msg: string) => void };
  entries: () => Record<string, unknown>[];
} {
  const lines: string[] = [];
  return {
    destination: { write: (msg: string) => void lines.push(msg.trim()) },
    entries: () => lines.map((line) => JSON.parse(line)),
  };
}

describe('PinoLoggerAdapter', () => {
  describe('child method optimization', () => {
    it('should create child logger without wasteful new pino instance', () => {
      const rootLogger = new PinoLoggerAdapter({ level: 'info' });

      const pinoSpy = jest.spyOn(pino, 'pino' as any);
      const childLogger = rootLogger.child({ module: 'test-module' });
      expect(childLogger).toBeDefined();
      expect(pinoSpy).not.toHaveBeenCalled();

      pinoSpy.mockRestore();
    });

    it('should accept a pino.Logger instance in constructor', () => {
      const pinoInstance = pino({ level: 'debug' });
      const adapter = new PinoLoggerAdapter(pinoInstance);

      expect(adapter).toBeDefined();
      expect(() => adapter.info('test message')).not.toThrow();
    });

    it('should properly chain child loggers', () => {
      const rootLogger = new PinoLoggerAdapter({ level: 'info' });
      const child1 = rootLogger.child({ service: 'api' });
      const child2 = child1.child({ module: 'auth' });

      expect(child1).toBeDefined();
      expect(child2).toBeDefined();
      expect(() => child2.info('test')).not.toThrow();
    });
  });

  describe('logging methods', () => {
    it('should log debug messages', () => {
      const adapter = new PinoLoggerAdapter({ level: 'debug' });
      expect(() => adapter.debug('debug message')).not.toThrow();
      expect(() => adapter.debug({ key: 'value' }, 'debug with context')).not.toThrow();
    });

    it('should log info messages', () => {
      const adapter = new PinoLoggerAdapter({ level: 'info' });
      expect(() => adapter.info('info message')).not.toThrow();
      expect(() => adapter.info({ key: 'value' }, 'info with context')).not.toThrow();
    });

    it('should log warn messages', () => {
      const adapter = new PinoLoggerAdapter({ level: 'warn' });
      expect(() => adapter.warn('warn message')).not.toThrow();
      expect(() => adapter.warn({ key: 'value' }, 'warn with context')).not.toThrow();
    });

    it('should log error messages', () => {
      const adapter = new PinoLoggerAdapter({ level: 'error' });
      expect(() => adapter.error('error message')).not.toThrow();
      expect(() => adapter.error({ key: 'value' }, 'error with context')).not.toThrow();
    });
  });

  describe('request context and mixin', () => {
    function createSink(): { sink: { write: (msg: string) => void }; getLines: () => string[] } {
      const lines: string[] = [];
      const sink = {
        write: (msg: string) => lines.push(msg.trim()),
      };
      return { sink, getLines: () => lines };
    }

    it('does not add request fields outside a request context', () => {
      // Fails if the adapter retains request context after its owning scope ends.
      const { sink, getLines } = createSink();
      const adapter = new PinoLoggerAdapter({ level: 'info', destination: sink });

      adapter.info('outside request');

      const [entry] = getLines().map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(entry).not.toHaveProperty('correlationId');
    });

    it('adds the current request fields to a real pino log line', () => {
      // Fails if the mixin stops reading the active request context at log time.
      const lines: string[] = [];
      const sink = { write: (msg: string) => lines.push(msg.trim()) };
      const adapter = new PinoLoggerAdapter({ level: 'info', destination: sink });

      runWithRequestContext('req-123', () => {
        adapter.info('request log');
      });

      const [entry] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(entry).toMatchObject({ correlationId: 'req-123', msg: 'request log' });
    });

    it('keeps request fields in child loggers', () => {
      // Fails if child loggers stop using the parent's per-call mixin.
      const { sink, getLines } = createSink();
      const childLogger = new PinoLoggerAdapter({ level: 'info', destination: sink }).child({ module: 'child-mod' });

      runWithRequestContext('req-child-456', () => {
        childLogger.info('child log entry');
      });

      const [entry] = getLines().map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(entry).toMatchObject({ correlationId: 'req-child-456', module: 'child-mod', msg: 'child log entry' });
    });

    it('includes extension fields added to the request context in a real log line', () => {
      // Fails if the mixin reads only the initial correlation id and misses later context updates.
      const { sink, getLines } = createSink();
      const adapter = new PinoLoggerAdapter({ level: 'info', destination: sink });

      runWithRequestContext('req-extension-789', () => {
        updateRequestContext({ userId: 'user-123', tenantId: 'tenant-456' });
        adapter.info('extended request log');
      });

      const [entry] = getLines().map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(entry).toMatchObject({
        correlationId: 'req-extension-789',
        userId: 'user-123',
        tenantId: 'tenant-456',
        msg: 'extended request log',
      });
    });

    it('keeps request fields in grandchild loggers', () => {
      // Fails if a second child level loses the parent's per-call mixin.
      const { sink, getLines } = createSink();
      const grandchildLogger = new PinoLoggerAdapter({ level: 'info', destination: sink })
        .child({ service: 'api' })
        .child({ module: 'grandchild' });

      runWithRequestContext('req-grandchild-012', () => {
        grandchildLogger.info('grandchild log entry');
      });

      const [entry] = getLines().map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(entry).toMatchObject({
        correlationId: 'req-grandchild-012',
        service: 'api',
        module: 'grandchild',
        msg: 'grandchild log entry',
      });
    });
  });
});

describe('PinoLoggerAdapter redaction', () => {
  it('redacts a top-level decryptionKey field', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.info({ decryptionKey: 'a'.repeat(64) }, 'storing credential');

    const [entry] = capture.entries();
    expect(entry.decryptionKey).toBe('[REDACTED]');
  });

  it('redacts a nested decryptionKey field', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.info({ credential: { id: 'cred-1', decryptionKey: 'a'.repeat(64) } }, 'credential issued');

    const [entry] = capture.entries();
    expect((entry.credential as Record<string, unknown>).decryptionKey).toBe('[REDACTED]');
    expect((entry.credential as Record<string, unknown>).id).toBe('cred-1');
  });

  it('redacts decryptionKey logged through a child logger', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.child({ module: 'issue-credential' }).info({ decryptionKey: 'a'.repeat(64) }, 'saving record');

    const [entry] = capture.entries();
    expect(entry.decryptionKey).toBe('[REDACTED]');
    expect(entry.module).toBe('issue-credential');
  });

  it('redacts additional paths supplied via redactPaths alongside the defaults', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({
      level: 'info',
      destination: capture.destination,
      redactPaths: ['sessionSecret'],
    });

    logger.info({ sessionSecret: 'secret-value', decryptionKey: 'a'.repeat(64) }, 'configuring service');

    const [entry] = capture.entries();
    expect(entry.sessionSecret).toBe('[REDACTED]');
    expect(entry.decryptionKey).toBe('[REDACTED]');
  });

  it.each(['apiKey', 'authorization', 'Authorization', 'token', 'password'])(
    'redacts a top-level %s field by default',
    (field) => {
      const capture = createCapture();
      const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

      logger.info({ [field]: 'secret-value' }, 'logging a secret-bearing object');

      const [entry] = capture.entries();
      expect(entry[field]).toBe('[REDACTED]');
    },
  );

  it('redacts apiKey nested one and two levels deep', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.info({ config: { apiKey: 'secret-key' } }, 'service configured');
    logger.info({ error: { config: { apiKey: 'secret-key' } } }, 'request failed');

    const [first, second] = capture.entries();
    expect((first.config as Record<string, unknown>).apiKey).toBe('[REDACTED]');
    expect((second.error as { config: Record<string, unknown> }).config.apiKey).toBe('[REDACTED]');
  });

  it('redacts Authorization two levels deep inside a logged object', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.error({ error: { headers: { Authorization: 'Bearer secret-token' } } }, 'request failed');

    const [entry] = capture.entries();
    const headers = (entry.error as { headers: Record<string, unknown> }).headers;
    expect(headers.Authorization).toBe('[REDACTED]');
  });

  it.each(['Authorization', 'authorization'])(
    'redacts %s in the HTTP client error shape error.config.headers',
    (field) => {
      const capture = createCapture();
      const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

      const error = new Error('request failed') as Error & { config: Record<string, unknown> };
      error.config = { headers: { [field]: 'Bearer secret-token' } };
      logger.error({ error }, 'request failed');

      const [entry] = capture.entries();
      const headers = (entry.error as { config: { headers: Record<string, unknown> } }).config.headers;
      expect(headers[field]).toBe('[REDACTED]');
    },
  );

  it('redacts decryptionKey inside an array of objects', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.info({ credentials: [{ id: 'cred-1', decryptionKey: 'a'.repeat(64) }] }, 'credentials listed');

    const [entry] = capture.entries();
    const [credential] = entry.credentials as Record<string, unknown>[];
    expect(credential.decryptionKey).toBe('[REDACTED]');
    expect(credential.id).toBe('cred-1');
  });

  it('redacts decryptionKey nested two levels deep', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.info({ result: { credential: { decryptionKey: 'a'.repeat(64) } } }, 'credential issued');

    const [entry] = capture.entries();
    const credential = (entry.result as { credential: Record<string, unknown> }).credential;
    expect(credential.decryptionKey).toBe('[REDACTED]');
  });

  it('does not redact decryptionKey nested three levels deep (each wildcard matches one level)', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.info(
      { outcome: { result: { credential: { decryptionKey: 'leaks-at-depth-three' } } } },
      'documenting the boundary',
    );

    const [entry] = capture.entries();
    const result = (entry.outcome as { result: { credential: Record<string, unknown> } }).result;
    expect(result.credential.decryptionKey).toBe('leaks-at-depth-three');
  });

  it('writes to the destination sink instead of the pretty transport when both are configured', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', pretty: true, destination: capture.destination });

    logger.info({ decryptionKey: 'a'.repeat(64) }, 'destination wins over pretty');

    // The pino-pretty worker-thread transport would bypass the sink entirely;
    // receiving parseable JSON here proves the destination guard held.
    const [entry] = capture.entries();
    expect(entry.msg).toBe('destination wins over pretty');
    expect(entry.decryptionKey).toBe('[REDACTED]');
  });

  it('leaves non-sensitive fields intact', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.info({ credentialId: 'cred-1', count: 3 }, 'credentials listed');

    const [entry] = capture.entries();
    expect(entry.credentialId).toBe('cred-1');
    expect(entry.count).toBe(3);
    expect(entry.msg).toBe('credentials listed');
  });
});

describe('PinoLoggerAdapter trace context', () => {
  it('adds the provider trace fields to a real pino log line without changing correlationId', () => {
    const capture = createCapture();
    const traceContextProvider = jest.fn(() => ({
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      traceFlags: 1,
    }));
    const logger = new PinoLoggerAdapter({
      level: 'info',
      correlationId: 'c1',
      destination: capture.destination,
      traceContextProvider,
    });

    logger.info({ traceId: 'bogus' }, 'request log');

    const [entry] = capture.entries();
    expect(entry).toMatchObject({
      correlationId: 'c1',
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
      traceFlags: 1,
      msg: 'request log',
    });
    expect(traceContextProvider).toHaveBeenCalledTimes(1);
  });

  it('does not mutate the object passed to a log call when adding context', () => {
    const capture = createCapture();
    const logContext = { event: 'request' };
    const logger = new PinoLoggerAdapter({
      level: 'info',
      destination: capture.destination,
      traceContextProvider: () => ({
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
      }),
    });

    logger.info(logContext, 'request log');

    expect(logContext).toEqual({ event: 'request' });
  });

  it('does not retain trace context when the same object is logged outside a span', () => {
    const capture = createCapture();
    const logContext = { event: 'request' };
    let activeTraceContext: { traceId: string; spanId: string; traceFlags?: number } | undefined = {
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
    };
    const logger = new PinoLoggerAdapter({
      level: 'info',
      destination: capture.destination,
      traceContextProvider: () => activeTraceContext,
    });

    logger.info(logContext, 'inside span');
    activeTraceContext = undefined;
    logger.info(logContext, 'outside span');

    const [inside, outside] = capture.entries();
    expect(inside).toMatchObject({
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
    });
    expect(outside).not.toHaveProperty('traceId');
    expect(outside).not.toHaveProperty('spanId');
    expect(outside).not.toHaveProperty('traceFlags');
    expect(logContext).toEqual({ event: 'request' });
  });

  it('logs a frozen object without mutating it', () => {
    const capture = createCapture();
    const logContext = Object.freeze({ event: 'request' });
    const logger = new PinoLoggerAdapter({
      level: 'info',
      destination: capture.destination,
      traceContextProvider: () => ({
        traceId: '0123456789abcdef0123456789abcdef',
        spanId: '0123456789abcdef',
      }),
    });

    expect(() => logger.info(logContext, 'frozen request log')).not.toThrow();

    const [entry] = capture.entries();
    expect(entry).toMatchObject({
      event: 'request',
      traceId: '0123456789abcdef0123456789abcdef',
      spanId: '0123456789abcdef',
    });
  });

  it('omits all trace fields when the provider has no active span', () => {
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({
      level: 'info',
      destination: capture.destination,
      traceContextProvider: () => undefined,
    });

    logger.info('outside span');

    const [entry] = capture.entries();
    expect(entry).not.toHaveProperty('traceId');
    expect(entry).not.toHaveProperty('spanId');
    expect(entry).not.toHaveProperty('traceFlags');
  });

  it('does not break logging when the trace provider throws and reports it once', () => {
    // Fails if provider errors escape the mixin or the designed report is removed or duplicated.
    const capture = createCapture();
    const providerError = new Error('trace provider failure');
    const traceContextProvider = jest.fn(() => {
      throw providerError;
    });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination, traceContextProvider });

    try {
      expect(() => {
        logger.info('provider failure is tolerated');
        logger.info('provider failure is tolerated again');
      }).not.toThrow();

      const [entry] = capture.entries();
      expect(entry).toMatchObject({ msg: 'provider failure is tolerated' });
      expect(entry).not.toHaveProperty('traceId');
      expect(capture.entries()).toHaveLength(2);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to get trace context for logging:', providerError);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does not break logging when reading request context throws and reports it once', () => {
    // Fails if a request-context read can escape the mixin and break a log line.
    const capture = createCapture();
    const requestContextError = new Error('request context failure');
    const getRequestContextSpy = jest.spyOn(requestContext, 'getRequestContext').mockImplementation(
      () =>
        ({
          get correlationId(): string {
            throw requestContextError;
          },
        }) as never,
    );
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    try {
      expect(() => {
        logger.info('request context failure is tolerated');
        logger.info('request context failure is tolerated again');
      }).not.toThrow();

      const [entry] = capture.entries();
      expect(entry).toMatchObject({ msg: 'request context failure is tolerated' });
      expect(capture.entries()).toHaveLength(2);
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to get request context for logging:', requestContextError);
    } finally {
      getRequestContextSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});

describe('PinoLoggerAdapter LOG_REDACT_PATHS environment variable', () => {
  const originalValue = process.env.LOG_REDACT_PATHS;

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env.LOG_REDACT_PATHS;
    } else {
      process.env.LOG_REDACT_PATHS = originalValue;
    }
  });

  it('redacts paths supplied via LOG_REDACT_PATHS alongside the defaults', () => {
    process.env.LOG_REDACT_PATHS = 'tenantSecret, *.webhookSignature';
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.info(
      { tenantSecret: 'secret-a', integration: { webhookSignature: 'secret-b' }, decryptionKey: 'secret-c' },
      'operator-extended redaction',
    );

    const [entry] = capture.entries();
    expect(entry.tenantSecret).toBe('[REDACTED]');
    expect((entry.integration as Record<string, unknown>).webhookSignature).toBe('[REDACTED]');
    expect(entry.decryptionKey).toBe('[REDACTED]');
  });

  it('tolerates surrounding whitespace and empty segments in LOG_REDACT_PATHS', () => {
    process.env.LOG_REDACT_PATHS = ' tenantSecret ,, ';
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.info({ tenantSecret: 'secret-a' }, 'trimmed path applies');

    const [entry] = capture.entries();
    expect(entry.tenantSecret).toBe('[REDACTED]');
  });

  it('redacts defaults, env paths, and config redactPaths together in one construction', () => {
    process.env.LOG_REDACT_PATHS = 'tenantSecret';
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({
      level: 'info',
      destination: capture.destination,
      redactPaths: ['sessionSecret'],
    });

    logger.info(
      { apiKey: 'from-defaults', tenantSecret: 'from-env', sessionSecret: 'from-config' },
      'all three sources apply',
    );

    const [entry] = capture.entries();
    expect(entry.apiKey).toBe('[REDACTED]');
    expect(entry.tenantSecret).toBe('[REDACTED]');
    expect(entry.sessionSecret).toBe('[REDACTED]');
  });

  it('children keep the parent redaction snapshot and do not re-read the environment', () => {
    process.env.LOG_REDACT_PATHS = 'tenantSecret';
    const capture = createCapture();
    const parent = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    process.env.LOG_REDACT_PATHS = 'bad[path';
    const child = parent.child({ module: 'late-child' });
    child.info({ tenantSecret: 'still-redacted' }, 'child inherits parent paths');

    const [entry] = capture.entries();
    expect(entry.tenantSecret).toBe('[REDACTED]');
    expect(() => new PinoLoggerAdapter({ level: 'info', destination: capture.destination })).toThrow(
      /LOG_REDACT_PATHS/,
    );
  });

  it('warns when LOG_REDACT_PATHS contains an empty segment', () => {
    const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    process.env.LOG_REDACT_PATHS = 'tenantSecret,,';
    const capture = createCapture();

    void new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('LOG_REDACT_PATHS'));
    consoleWarnSpy.mockRestore();
  });

  it('propagates a non-redact construction failure without naming LOG_REDACT_PATHS', () => {
    const capture = createCapture();

    const config = { level: 'not-a-level', destination: capture.destination };

    expect(
      () => new PinoLoggerAdapter(config as unknown as ConstructorParameters<typeof PinoLoggerAdapter>[0]),
    ).toThrow(/^(?!.*LOG_REDACT_PATHS).*level/);
  });

  it.each(['', '   '])('applies only the defaults when LOG_REDACT_PATHS is %j', (value) => {
    process.env.LOG_REDACT_PATHS = value;
    const capture = createCapture();
    const logger = new PinoLoggerAdapter({ level: 'info', destination: capture.destination });

    logger.info({ apiKey: 'secret-key', tenantSecret: 'not-a-default' }, 'blank env value');

    const [entry] = capture.entries();
    expect(entry.apiKey).toBe('[REDACTED]');
    expect(entry.tenantSecret).toBe('not-a-default');
  });

  it('fails logger construction with an error naming LOG_REDACT_PATHS and the configured paths', () => {
    process.env.LOG_REDACT_PATHS = 'valid.path,bad[path';
    const capture = createCapture();

    expect(() => new PinoLoggerAdapter({ level: 'info', destination: capture.destination })).toThrow(
      /LOG_REDACT_PATHS.*currently: valid\.path, bad\[path/,
    );
  });

  it('propagates a code-supplied invalid redactPaths error without naming LOG_REDACT_PATHS', () => {
    const capture = createCapture();

    expect(
      () => new PinoLoggerAdapter({ level: 'info', destination: capture.destination, redactPaths: ['bad[path'] }),
    ).toThrow(/^(?!.*LOG_REDACT_PATHS).*Invalid redaction path/);
  });
});
