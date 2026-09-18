import { parseOperatorArgs } from '../../scripts/parse-operator-args';

const entriesOptions = {
  'dry-run': { type: 'boolean' as const, default: false },
  'retry-failed': { type: 'boolean' as const, default: false },
  tenant: { type: 'string' as const },
};

const attributionOptions = {
  tenant: { type: 'string' as const },
  instance: { type: 'string' as const },
  reason: { type: 'string' as const },
  'dry-run': { type: 'boolean' as const, default: false },
  reassign: { type: 'boolean' as const, default: false },
};

const repairOptions = {
  instance: { type: 'string' as const },
  config: { type: 'string' as const },
  'allow-pending': { type: 'boolean' as const, default: false },
};

const batchInspectOptions = {
  tenant: { type: 'string' as const },
  batch: { type: 'string' as const },
  index: { type: 'string' as const },
  reason: { type: 'string' as const },
  'disclose-request': { type: 'boolean' as const, default: false },
};

const batchResolveOptions = {
  tenant: { type: 'string' as const },
  batch: { type: 'string' as const },
  index: { type: 'string' as const },
  version: { type: 'string' as const },
  issued: { type: 'string' as const },
  evidence: { type: 'string' as const },
  reason: { type: 'string' as const },
  'dry-run': { type: 'boolean' as const, default: false },
  failed: { type: 'boolean' as const, default: false },
};

describe('parseOperatorArgs', () => {
  it('accepts every documented entries flag so a caller option cannot be rejected accidentally', () => {
    expect(parseOperatorArgs(['--dry-run', '--retry-failed', '--tenant', 'tenant-1'], entriesOptions).values).toEqual({
      'dry-run': true,
      'retry-failed': true,
      tenant: 'tenant-1',
    });
  });

  it('accepts every documented attribution flag so a caller option cannot be dropped accidentally', () => {
    expect(
      parseOperatorArgs(
        [
          '--tenant',
          'tenant-1',
          '--instance',
          'instance-1',
          '--reason',
          'historical mapping',
          '--dry-run',
          '--reassign',
        ],
        attributionOptions,
      ).values,
    ).toEqual({
      tenant: 'tenant-1',
      instance: 'instance-1',
      reason: 'historical mapping',
      'dry-run': true,
      reassign: true,
    });
  });

  it('accepts every documented repair flag so the operator command remains callable', () => {
    expect(
      parseOperatorArgs(['--instance', 'instance-1', '--config', 'config.json', '--allow-pending'], repairOptions)
        .values,
    ).toEqual({ instance: 'instance-1', config: 'config.json', 'allow-pending': true });
  });

  it('accepts --tenant=id so equals-form values are not misparsed', () => {
    expect(parseOperatorArgs(['--tenant=tenant-1'], entriesOptions).values).toEqual({
      'dry-run': false,
      'retry-failed': false,
      tenant: 'tenant-1',
    });
  });

  it('strips a leading -- so package-script separators remain accepted', () => {
    expect(parseOperatorArgs(['--', '--dry-run'], entriesOptions).values).toEqual({
      'dry-run': true,
      'retry-failed': false,
    });
  });

  it('rejects a missing value so a string option cannot become undefined', () => {
    expect(() => parseOperatorArgs(['--tenant'], entriesOptions)).toThrow("Option '--tenant <value>' argument missing");
  });

  it('rejects repeated --tenant with the exact message so duplicate options cannot silently win', () => {
    expect(() => parseOperatorArgs(['--tenant', 'first', '--tenant', 'second'], entriesOptions)).toThrow(
      new Error('--tenant must be supplied only once.'),
    );
  });

  it('rejects unknown options so operator typos cannot be ignored', () => {
    expect(() => parseOperatorArgs(['--unknown'], entriesOptions)).toThrow("Unknown option '--unknown'");
  });

  it('rejects extra positional words so operator commands remain option-only', () => {
    expect(() => parseOperatorArgs(['unexpected'], entriesOptions)).toThrow(
      "Unexpected argument 'unexpected'. This command does not take positional arguments",
    );
  });

  it('rejects --dry-run=true so boolean options cannot receive string values', () => {
    expect(() => parseOperatorArgs(['--dry-run=true'], entriesOptions)).toThrow(
      "Option '--dry-run' does not take an argument",
    );
  });

  it('accepts every documented batch inspection flag after the package-script separator', () => {
    expect(
      parseOperatorArgs(
        ['--', '--tenant', 'tenant-1', '--batch', 'batch-1', '--index', '4', '--reason', 'INC-1', '--disclose-request'],
        batchInspectOptions,
      ).values,
    ).toEqual({
      tenant: 'tenant-1',
      batch: 'batch-1',
      index: '4',
      reason: 'INC-1',
      'disclose-request': true,
    });
  });

  it('accepts every documented batch resolution flag without an operator name', () => {
    expect(
      parseOperatorArgs(
        [
          '--tenant',
          'tenant-1',
          '--batch',
          'batch-1',
          '--index',
          '0',
          '--version',
          '7',
          '--issued',
          'credential-1',
          '--reason',
          'INC-2',
          '--dry-run',
        ],
        batchResolveOptions,
      ).values,
    ).toEqual({
      tenant: 'tenant-1',
      batch: 'batch-1',
      index: '0',
      version: '7',
      issued: 'credential-1',
      reason: 'INC-2',
      'dry-run': true,
      failed: false,
    });
  });

  it('accepts failed batch resolution flags with evidence', () => {
    expect(
      parseOperatorArgs(
        [
          '--tenant',
          'tenant-1',
          '--batch',
          'batch-1',
          '--index',
          '0',
          '--version',
          '7',
          '--failed',
          '--evidence',
          'no credential was issued',
          '--reason',
          'INC-3',
        ],
        batchResolveOptions,
      ).values,
    ).toEqual({
      tenant: 'tenant-1',
      batch: 'batch-1',
      index: '0',
      version: '7',
      failed: true,
      evidence: 'no credential was issued',
      reason: 'INC-3',
      'dry-run': false,
    });
  });

  it('rejects the removed batch operator flag as unknown', () => {
    expect(() => parseOperatorArgs(['--tenant', 'tenant-1', '--operator', 'operator-1'], batchInspectOptions)).toThrow(
      "Unknown option '--operator'",
    );
  });
});
