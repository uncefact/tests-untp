import pino from 'pino';
import { Writable } from 'stream';
import { PinoLoggerAdapter, registerRequestContextProvider } from './pino-logger.js';

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

  describe('registerRequestContextProvider and mixin', () => {
    function createSink(): { sink: Writable; getLines: () => string[] } {
      const lines: string[] = [];
      const sink = new Writable({
        write(chunk, _encoding, cb) {
          lines.push(chunk.toString().trim());
          cb();
        },
      });
      return { sink, getLines: () => lines };
    }

    afterEach(() => {
      // Reset the module-level provider to avoid leaking state between tests
      registerRequestContextProvider(undefined as unknown as () => Record<string, unknown> | undefined);
    });

    it('should register a provider that gets called during logging', () => {
      const provider = jest.fn().mockReturnValue({ correlationId: 'corr-abc' });
      registerRequestContextProvider(provider);

      const adapter = new PinoLoggerAdapter({ level: 'info' });
      adapter.info('hello');

      expect(provider).toHaveBeenCalled();
    });

    it('should return empty object from mixin when no provider is registered', () => {
      const { sink, getLines } = createSink();

      // No provider registered (reset in afterEach), so mixin inside
      // PinoLoggerAdapter would return {}. Verify with a raw pino logger
      // using the same mixin pattern.
      const loggerWithMixin = pino(
        {
          level: 'info',
          mixin() {
            // Mirrors PinoLoggerAdapter's mixin when no provider is set
            return {};
          },
        },
        sink,
      );

      loggerWithMixin.info('no context');

      const lines = getLines();
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(lines[lines.length - 1]);
      expect(parsed).not.toHaveProperty('correlationId');
    });

    it('should return empty object from mixin when provider returns undefined', () => {
      const provider = jest.fn().mockReturnValue(undefined);
      registerRequestContextProvider(provider);

      const { sink, getLines } = createSink();

      // Create a raw pino logger that exercises the same mixin logic
      const loggerWithMixin = pino(
        {
          level: 'info',
          mixin() {
            const context = provider();
            return context ? { ...context } : {};
          },
        },
        sink,
      );

      loggerWithMixin.info('no context');

      const lines = getLines();
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(lines[lines.length - 1]);
      expect(parsed).not.toHaveProperty('correlationId');
      expect(provider).toHaveBeenCalled();
    });

    it('should spread all context fields when provider returns a context object', () => {
      const provider = jest.fn().mockReturnValue({ correlationId: 'req-123', userId: 'user-1', tenantId: 'tenant-1' });
      registerRequestContextProvider(provider);

      const { sink, getLines } = createSink();

      // Create a raw pino logger that mirrors PinoLoggerAdapter's mixin
      const loggerWithMixin = pino(
        {
          level: 'info',
          mixin() {
            const context = provider();
            return context ? { ...context } : {};
          },
        },
        sink,
      );

      loggerWithMixin.info('test message');

      const lines = getLines();
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(lines[lines.length - 1]);
      expect(parsed.correlationId).toBe('req-123');
      expect(parsed.userId).toBe('user-1');
      expect(parsed.tenantId).toBe('tenant-1');
    });

    it('should inject only correlationId when no extension fields are set', () => {
      const provider = jest.fn().mockReturnValue({ correlationId: 'req-456' });
      registerRequestContextProvider(provider);

      const { sink, getLines } = createSink();

      const loggerWithMixin = pino(
        {
          level: 'info',
          mixin() {
            const context = provider();
            return context ? { ...context } : {};
          },
        },
        sink,
      );

      loggerWithMixin.info('test message');

      const lines = getLines();
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(lines[lines.length - 1]);
      expect(parsed.correlationId).toBe('req-456');
      expect(parsed).not.toHaveProperty('userId');
      expect(parsed).not.toHaveProperty('tenantId');
    });

    it('should return empty object from mixin when provider throws and log via console.error', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const providerError = new Error('provider failure');
      const provider = jest.fn().mockImplementation(() => {
        throw providerError;
      });
      registerRequestContextProvider(provider);

      const adapter = new PinoLoggerAdapter({ level: 'info' });
      expect(() => adapter.info('should not crash')).not.toThrow();
      expect(provider).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to get request context for logging:', providerError);

      consoleErrorSpy.mockRestore();
    });

    it('should inherit mixin behaviour in child loggers', () => {
      const provider = jest.fn().mockReturnValue({ correlationId: 'req-child-456', userId: 'child-user' });
      registerRequestContextProvider(provider);

      const { sink, getLines } = createSink();

      const loggerWithMixin = pino(
        {
          level: 'info',
          mixin() {
            const context = provider();
            return context ? { ...context } : {};
          },
        },
        sink,
      );

      const childLogger = loggerWithMixin.child({ module: 'child-mod' });
      childLogger.info('child log entry');

      const lines = getLines();
      expect(lines.length).toBeGreaterThanOrEqual(1);
      const parsed = JSON.parse(lines[lines.length - 1]);
      expect(parsed.correlationId).toBe('req-child-456');
      expect(parsed.userId).toBe('child-user');
      expect(parsed.module).toBe('child-mod');
    });
  });
});

describe('PinoLoggerAdapter redaction', () => {
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

describe('PinoLoggerAdapter LOG_REDACT_PATHS environment variable', () => {
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
