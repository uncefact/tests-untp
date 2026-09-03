import { prismaSqlExecutor } from './prisma-sql-executor';
import type { Prisma } from '@/lib/prisma/generated';

describe('prismaSqlExecutor', () => {
  it('passes the SQL text and positional values through unchanged and returns the rows', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([{ id: 'job-1' }]);
    const executor = prismaSqlExecutor({ $queryRawUnsafe: queryRawUnsafe } as unknown as Prisma.TransactionClient);

    await expect(executor.executeSql('INSERT INTO q VALUES ($1, $2) RETURNING id', ['a', 2])).resolves.toEqual({
      rows: [{ id: 'job-1' }],
    });
    expect(queryRawUnsafe).toHaveBeenCalledWith('INSERT INTO q VALUES ($1, $2) RETURNING id', 'a', 2);
  });

  it('sends no parameters when none are given', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue([]);
    const executor = prismaSqlExecutor({ $queryRawUnsafe: queryRawUnsafe } as unknown as Prisma.TransactionClient);

    await expect(executor.executeSql('SELECT 1')).resolves.toEqual({ rows: [] });
    expect(queryRawUnsafe).toHaveBeenCalledWith('SELECT 1');
  });

  it('fails loudly on a result that is not a row set, rather than reporting no rows', async () => {
    const queryRawUnsafe = jest.fn().mockResolvedValue(3);
    const executor = prismaSqlExecutor({ $queryRawUnsafe: queryRawUnsafe } as unknown as Prisma.TransactionClient);

    await expect(executor.executeSql('SELECT 1')).rejects.toThrow('expected a row set');
  });
});
