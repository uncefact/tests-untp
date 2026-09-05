export {};

type Constructed = {
  options: { connectionString: string; onError?: (error: Error) => void };
  start: jest.Mock;
  stop: jest.Mock;
  declareQueue: jest.Mock;
};

/** Every PgBossJobQueue the module under test built, newest last. */
const constructed: Constructed[] = [];
/** Applied by the next construction's start, so a test can make one start fail. */
let nextStart: () => Promise<void> = async () => {};
/** Applied by the next construction's declareQueue, so a test can make one declaration fail. */
let nextDeclareQueue: (name: string) => Promise<void> = async () => {};

const logError = jest.fn();
const logInfo = jest.fn();

jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: logInfo, warn: jest.fn(), error: logError }) },
}));

jest.mock('./pg-boss-job-queue', () => ({
  PgBossJobQueue: class {
    start: jest.Mock;
    stop: jest.Mock;
    declareQueue: jest.Mock;
    constructor(options: Constructed['options']) {
      this.start = jest.fn(() => nextStart());
      this.stop = jest.fn(async () => {});
      this.declareQueue = jest.fn((name: string) => nextDeclareQueue(name));
      constructed.push({ options, start: this.start, stop: this.stop, declareQueue: this.declareQueue });
    }
  },
}));

type JobQueueModule = typeof import('./app-job-queue');

/** A fresh copy of the module, because it holds the process's queue in module state. */
function loadModule(): JobQueueModule {
  let loaded: JobQueueModule | undefined;
  jest.isolateModules(() => {
    loaded = jest.requireActual<JobQueueModule>('./app-job-queue');
  });
  if (!loaded) throw new Error('module did not load');
  return loaded;
}

const DATABASE_ENV_KEYS = [
  'RI_DATABASE_URL',
  'RI_POSTGRES_USER',
  'RI_POSTGRES_PASSWORD',
  'RI_POSTGRES_DB',
  'RI_POSTGRES_HOST',
  'RI_POSTGRES_PORT',
] as const;

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  jest.clearAllMocks();
  constructed.length = 0;
  nextStart = async () => {};
  nextDeclareQueue = async () => {};
  for (const key of DATABASE_ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of DATABASE_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

function setUrlParts(): void {
  process.env.RI_POSTGRES_USER = 'ri';
  process.env.RI_POSTGRES_PASSWORD = 'secret';
  process.env.RI_POSTGRES_DB = 'ri';
  process.env.RI_POSTGRES_HOST = 'db.test';
  process.env.RI_POSTGRES_PORT = '5432';
}

describe('startJobQueue', () => {
  it('builds one queue from RI_DATABASE_URL and returns it started', async () => {
    process.env.RI_DATABASE_URL = 'postgresql://ri:secret@db.test:5432/ri?schema=public';
    const { startJobQueue } = loadModule();

    const queue = await startJobQueue();

    expect(constructed).toHaveLength(1);
    expect(constructed[0].options.connectionString).toBe('postgresql://ri:secret@db.test:5432/ri?schema=public');
    expect(constructed[0].start).toHaveBeenCalledTimes(1);
    expect(queue).toBe((constructed[0].start as jest.Mock).mock.instances[0]);
  });

  it('starts once when two callers race, and both receive the same queue', async () => {
    process.env.RI_DATABASE_URL = 'postgresql://ri:secret@db.test:5432/ri?schema=public';
    const { startJobQueue } = loadModule();

    const [first, second] = await Promise.all([startJobQueue(), startJobQueue()]);

    expect(constructed).toHaveLength(1);
    expect(constructed[0].start).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('builds the connection string from the RI_POSTGRES_* parts when no URL is set', async () => {
    setUrlParts();
    const { startJobQueue } = loadModule();

    await startJobQueue();

    expect(constructed[0].options.connectionString).toBe('postgresql://ri:secret@db.test:5432/ri?schema=public');
  });

  it('prefers an explicitly set RI_DATABASE_URL over the parts', async () => {
    setUrlParts();
    process.env.RI_DATABASE_URL = 'postgresql://explicit@elsewhere.test:5432/other';
    const { startJobQueue } = loadModule();

    await startJobQueue();

    expect(constructed[0].options.connectionString).toBe('postgresql://explicit@elsewhere.test:5432/other');
  });

  it('throws a coded error when neither the URL nor a complete set of parts is set', async () => {
    process.env.RI_POSTGRES_USER = 'ri';
    const { startJobQueue } = loadModule();

    await expect(startJobQueue()).rejects.toMatchObject({
      name: 'JobQueueError',
      code: 'jobs.database-url-missing',
      message: 'RI_DATABASE_URL (or the RI_POSTGRES_* parts) must be set for the job queue',
    });
    expect(constructed).toHaveLength(0);
  });

  it('does not memoise a failed start, so a later call starts again', async () => {
    process.env.RI_DATABASE_URL = 'postgresql://ri:secret@db.test:5432/ri?schema=public';
    const { startJobQueue } = loadModule();
    const failure = new Error('connection refused');
    nextStart = async () => {
      nextStart = async () => {};
      throw failure;
    };

    await expect(startJobQueue()).rejects.toBe(failure);
    await expect(startJobQueue()).resolves.toBeDefined();

    expect(constructed).toHaveLength(1);
    expect(constructed[0].start).toHaveBeenCalledTimes(2);
  });

  it('declares the verify queue after starting, so a transactional send is one insert', async () => {
    // Fails if the declaration is dropped, or moved before start, which would
    // create the queue on a connection the queue has not opened yet.
    process.env.RI_DATABASE_URL = 'postgresql://ri:secret@db.test:5432/ri?schema=public';
    const { startJobQueue } = loadModule();

    await startJobQueue();

    expect(constructed[0].declareQueue).toHaveBeenCalledWith('library.verify-generation');
    expect(constructed[0].declareQueue).toHaveBeenCalledTimes(1);
    expect(constructed[0].declareQueue.mock.invocationCallOrder[0]).toBeGreaterThan(
      constructed[0].start.mock.invocationCallOrder[0],
    );
    expect(logInfo).toHaveBeenCalledWith(
      { queues: ['library.verify-generation'] },
      'Job queue started; sending queues declared',
    );
  });

  it('does not memoise a start whose queue declaration failed, so a later call starts again', async () => {
    // Fails if a declaration failure escapes the try that clears the memo: the
    // second call would then hand every later caller the same rejected promise.
    process.env.RI_DATABASE_URL = 'postgresql://ri:secret@db.test:5432/ri?schema=public';
    const { startJobQueue } = loadModule();
    const failure = new Error('queue could not be created');
    nextDeclareQueue = async () => {
      nextDeclareQueue = async () => {};
      throw failure;
    };

    await expect(startJobQueue()).rejects.toBe(failure);
    await expect(startJobQueue()).resolves.toBeDefined();

    expect(constructed).toHaveLength(1);
    expect(constructed[0].start).toHaveBeenCalledTimes(2);
    expect(constructed[0].declareQueue).toHaveBeenCalledTimes(2);
  });

  it('logs through the module logger when the queue reports an error', async () => {
    process.env.RI_DATABASE_URL = 'postgresql://ri:secret@db.test:5432/ri?schema=public';
    const { startJobQueue } = loadModule();
    await startJobQueue();

    const reported = new Error('lost the connection');
    constructed[0].options.onError?.(reported);

    expect(logError).toHaveBeenCalledWith({ err: reported }, 'Job queue reported an error');
  });
});

describe('stopJobQueue', () => {
  it('stops the built queue and lets the next start build a fresh one', async () => {
    process.env.RI_DATABASE_URL = 'postgresql://ri:secret@db.test:5432/ri?schema=public';
    const { startJobQueue, stopJobQueue } = loadModule();
    await startJobQueue();

    await stopJobQueue();

    expect(constructed[0].stop).toHaveBeenCalledTimes(1);

    await startJobQueue();
    expect(constructed).toHaveLength(2);
    expect(constructed[1].start).toHaveBeenCalledTimes(1);
  });

  it('resolves without building anything when no queue was ever started', async () => {
    const { stopJobQueue } = loadModule();

    await expect(stopJobQueue()).resolves.toBeUndefined();

    expect(constructed).toHaveLength(0);
  });

  it('is safe to call twice, stopping the queue only once', async () => {
    process.env.RI_DATABASE_URL = 'postgresql://ri:secret@db.test:5432/ri?schema=public';
    const { startJobQueue, stopJobQueue } = loadModule();
    await startJobQueue();

    await stopJobQueue();
    await stopJobQueue();

    expect(constructed[0].stop).toHaveBeenCalledTimes(1);
  });
});

describe("createJobQueue (the worker's construction path)", () => {
  it('builds an unstarted queue against the resolved target so handlers can be registered before start', () => {
    process.env.RI_DATABASE_URL = 'postgresql://u:p@h:5432/db';
    const loaded = loadModule();
    const queue = loaded.createJobQueue();
    expect(queue).toBeDefined();
    expect(constructed).toHaveLength(1);
    expect(constructed[0].options.connectionString).toBe('postgresql://u:p@h:5432/db');
    expect(constructed[0].start).not.toHaveBeenCalled();
  });

  it('fails with the same missing-target error the web process gets', () => {
    const loaded = loadModule();
    expect(() => loaded.resolveQueueConnectionString()).toThrow(
      expect.objectContaining({ code: 'jobs.database-url-missing' }),
    );
    expect(() => loaded.createJobQueue()).toThrow(expect.objectContaining({ code: 'jobs.database-url-missing' }));
    expect(constructed).toHaveLength(0);
  });
});
