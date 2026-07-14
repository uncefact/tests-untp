import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';
import {
  isUniqueConstraintViolation,
  isForeignKeyViolation,
  isRecordNotFound,
  isDatabaseError,
  mapDatabaseError,
} from './db-errors';

/** Mimics the shape of a PrismaClientKnownRequestError without depending on the generated client. */
function prismaKnownError(code: string): Error {
  const error = new Error(
    `\nInvalid \`prisma.identifier.create()\` invocation:\n\nUnique constraint failed on the fields: (\`schemeId\`,\`value\`,\`tenantId\`)`,
  );
  error.name = 'PrismaClientKnownRequestError';
  Object.assign(error, { code, clientVersion: '6.0.0' });
  return error;
}

describe('isUniqueConstraintViolation', () => {
  it('matches a P2002 error', () => {
    expect(isUniqueConstraintViolation(prismaKnownError('P2002'))).toBe(true);
  });

  it('rejects other Prisma codes, plain errors, and non-objects', () => {
    expect(isUniqueConstraintViolation(prismaKnownError('P2025'))).toBe(false);
    expect(isUniqueConstraintViolation(new Error('P2002'))).toBe(false);
    expect(isUniqueConstraintViolation(null)).toBe(false);
    expect(isUniqueConstraintViolation('P2002')).toBe(false);
  });
});

describe('isForeignKeyViolation', () => {
  it('matches only P2003', () => {
    expect(isForeignKeyViolation(prismaKnownError('P2003'))).toBe(true);
    expect(isForeignKeyViolation(prismaKnownError('P2002'))).toBe(false);
  });
});

describe('isRecordNotFound', () => {
  it('matches only P2025', () => {
    expect(isRecordNotFound(prismaKnownError('P2025'))).toBe(true);
    expect(isRecordNotFound(prismaKnownError('P2003'))).toBe(false);
  });
});

describe('isDatabaseError', () => {
  it('matches errors carrying clientVersion', () => {
    expect(isDatabaseError(prismaKnownError('P2002'))).toBe(true);
  });

  it('matches PrismaClient*-named errors without clientVersion', () => {
    const error = new Error('Argument `id`: Invalid value provided.');
    error.name = 'PrismaClientValidationError';
    expect(isDatabaseError(error)).toBe(true);
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
});

describe('mapDatabaseError', () => {
  it('maps P2002 to ConflictError with the contextual message', () => {
    const call = () => mapDatabaseError(prismaKnownError('P2002'), { conflict: 'Identifier already exists' });

    expect(call).toThrow(ConflictError);
    expect(call).toThrow('Identifier already exists');
  });

  it('maps P2025 to NotFoundError with the contextual message', () => {
    expect(() => mapDatabaseError(prismaKnownError('P2025'), { notFound: 'Identifier not found' })).toThrow(
      NotFoundError,
    );
  });

  it('maps P2003 to ValidationError with the contextual message', () => {
    expect(() =>
      mapDatabaseError(prismaKnownError('P2003'), { invalidReference: 'Referenced scheme does not exist' }),
    ).toThrow(ValidationError);
  });

  it('rethrows a database error whose code the context does not cover', () => {
    const error = prismaKnownError('P2025');
    expect(() => mapDatabaseError(error, { conflict: 'Identifier already exists' })).toThrow(error);
  });

  it('rethrows non-database errors unchanged', () => {
    const error = new Error('network down');
    expect(() => mapDatabaseError(error, { conflict: 'x', notFound: 'y', invalidReference: 'z' })).toThrow(error);
  });

  it('rethrows a non-database error even when it carries a matching code property', () => {
    const impostor = Object.assign(new Error('not from the ORM'), { code: 'P2002' });
    expect(() => mapDatabaseError(impostor, { conflict: 'x' })).toThrow(impostor);
  });
});
