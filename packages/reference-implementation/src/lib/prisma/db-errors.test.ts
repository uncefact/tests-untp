import { Prisma } from './generated';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import {
  isUniqueConstraintViolation,
  isForeignKeyViolation,
  isRecordNotFound,
  isDatabaseError,
  mapDatabaseError,
} from './db-errors';
import {
  prismaUniqueConstraintError,
  prismaForeignKeyViolationError,
  prismaRecordNotFoundError,
} from './db-errors.fixtures';

/** Runs a throwing function and returns the thrown value, for identity assertions. */
function captureThrown(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('Expected function to throw');
}

describe('isUniqueConstraintViolation', () => {
  it('matches a P2002 error', () => {
    expect(isUniqueConstraintViolation(prismaUniqueConstraintError())).toBe(true);
  });

  it('rejects other Prisma codes, plain errors, and non-objects', () => {
    expect(isUniqueConstraintViolation(prismaRecordNotFoundError())).toBe(false);
    expect(isUniqueConstraintViolation(new Error('P2002'))).toBe(false);
    expect(isUniqueConstraintViolation(null)).toBe(false);
    expect(isUniqueConstraintViolation('P2002')).toBe(false);
  });

  it('rejects a non-Prisma error carrying a matching code property', () => {
    const impostor = Object.assign(new Error('not from the ORM'), { code: 'P2002' });
    expect(isUniqueConstraintViolation(impostor)).toBe(false);
  });

  it('matches the code guards for a clientVersion-only error carrying a matching code', () => {
    // Anchors the code guards to the clientVersion boundary-crossing signal
    // (see isDatabaseError below), not just the PrismaClient*-named branch.
    const impostor = Object.assign(new Error('lost identity'), { clientVersion: '6.19.2', code: 'P2002' });
    expect(isUniqueConstraintViolation(impostor)).toBe(true);
  });
});

describe('isForeignKeyViolation', () => {
  it('matches only P2003', () => {
    expect(isForeignKeyViolation(prismaForeignKeyViolationError())).toBe(true);
    expect(isForeignKeyViolation(prismaUniqueConstraintError())).toBe(false);
  });

  it('rejects a non-Prisma error carrying a matching code property', () => {
    const impostor = Object.assign(new Error('not from the ORM'), { code: 'P2003' });
    expect(isForeignKeyViolation(impostor)).toBe(false);
  });
});

describe('isRecordNotFound', () => {
  it('matches only P2025', () => {
    expect(isRecordNotFound(prismaRecordNotFoundError())).toBe(true);
    expect(isRecordNotFound(prismaForeignKeyViolationError())).toBe(false);
  });

  it('rejects a non-Prisma error carrying a matching code property', () => {
    const impostor = Object.assign(new Error('not from the ORM'), { code: 'P2025' });
    expect(isRecordNotFound(impostor)).toBe(false);
  });
});

describe('isDatabaseError', () => {
  it('matches errors carrying clientVersion', () => {
    expect(isDatabaseError(prismaUniqueConstraintError())).toBe(true);
  });

  it('matches PrismaClient*-named errors without clientVersion', () => {
    const error = new Error('Argument `id`: Invalid value provided.');
    error.name = 'PrismaClientValidationError';
    expect(isDatabaseError(error)).toBe(true);
  });

  it('matches an object carrying clientVersion whose name does not start with PrismaClient', () => {
    // clientVersion is the boundary-crossing signal: `name` can be lost when
    // an error crosses a transaction callback or module boundary, but the
    // ORM still attaches clientVersion.
    const impostor = Object.assign(new Error('lost identity'), { clientVersion: '6.19.2' });
    expect(isDatabaseError(impostor)).toBe(true);
  });

  it('rejects application errors and non-objects', () => {
    expect(isDatabaseError(new ConflictError('conflict'))).toBe(false);
    expect(isDatabaseError(new Error('boom'))).toBe(false);
    expect(isDatabaseError(undefined)).toBe(false);
  });

  it('returns false without throwing when name is not a string', () => {
    const mangled = new Error('boom');
    Object.defineProperty(mangled, 'name', { value: undefined });
    expect(isDatabaseError(mangled)).toBe(false);
  });

  it('recognises a real PrismaClientKnownRequestError instance', () => {
    // Anchors the duck-type guards (and the fixtures module they share) against
    // the real generated Prisma class, so the two cannot drift together.
    const realError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.2',
    });
    expect(isDatabaseError(realError)).toBe(true);
    expect(isUniqueConstraintViolation(realError)).toBe(true);
  });
});

describe('mapDatabaseError', () => {
  it('maps P2002 to ConflictError with the contextual message', () => {
    const call = () => mapDatabaseError(prismaUniqueConstraintError(), { conflict: 'Identifier already exists' });

    expect(call).toThrow(ConflictError);
    expect(call).toThrow('Identifier already exists');
  });

  it('maps P2025 to NotFoundError with the contextual message', () => {
    expect(() => mapDatabaseError(prismaRecordNotFoundError(), { notFound: 'Identifier not found' })).toThrow(
      NotFoundError,
    );
  });

  it('maps P2003 to ValidationError with the contextual message', () => {
    expect(() =>
      mapDatabaseError(prismaForeignKeyViolationError(), { invalidReference: 'Referenced scheme does not exist' }),
    ).toThrow(ValidationError);
  });

  it('rethrows a database error whose code the context does not cover', () => {
    const error = prismaRecordNotFoundError();
    const caught = captureThrown(() => mapDatabaseError(error, { conflict: 'Identifier already exists' }));
    expect(caught).toBe(error);
  });

  it('rethrows non-database errors unchanged', () => {
    const error = new Error('network down');
    const caught = captureThrown(() =>
      mapDatabaseError(error, { conflict: 'x', notFound: 'y', invalidReference: 'z' }),
    );
    expect(caught).toBe(error);
  });

  it('rethrows a non-database error even when it carries a matching code property', () => {
    const impostor = Object.assign(new Error('not from the ORM'), { code: 'P2002' });
    const caught = captureThrown(() => mapDatabaseError(impostor, { conflict: 'x' }));
    expect(caught).toBe(impostor);
  });
});
