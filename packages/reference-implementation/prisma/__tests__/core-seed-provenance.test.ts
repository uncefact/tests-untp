import { convergeCoreProvenance } from '../core-seed-provenance';
import { RecordSource } from '../../src/lib/prisma/generated/index.js';

describe('convergeCoreProvenance', () => {
  it('stamps CORE_SEED onto a row whose provenance predates tracking (USER)', async () => {
    const delegate = { update: jest.fn().mockResolvedValue({}) };

    const updated = await convergeCoreProvenance(delegate, 'core-id-1', RecordSource.USER);

    expect(updated).toBe(true);
    expect(delegate.update).toHaveBeenCalledWith({
      where: { id: 'core-id-1' },
      data: { source: RecordSource.CORE_SEED },
    });
  });

  it('stamps CORE_SEED onto a row wrongly claimed as CUSTOM_SEED', async () => {
    const delegate = { update: jest.fn().mockResolvedValue({}) };

    const updated = await convergeCoreProvenance(delegate, 'core-id-1', RecordSource.CUSTOM_SEED);

    expect(updated).toBe(true);
    expect(delegate.update).toHaveBeenCalled();
  });

  it('writes nothing when the row already carries CORE_SEED', async () => {
    const delegate = { update: jest.fn().mockResolvedValue({}) };

    const updated = await convergeCoreProvenance(delegate, 'core-id-1', RecordSource.CORE_SEED);

    expect(updated).toBe(false);
    expect(delegate.update).not.toHaveBeenCalled();
  });
});
