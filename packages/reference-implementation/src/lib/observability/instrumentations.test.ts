/**
 * @jest-environment node
 */
const mockGetNodeAutoInstrumentations = jest.fn().mockReturnValue([]);

jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: (...args: unknown[]) => mockGetNodeAutoInstrumentations(...args),
}));

import { buildInstrumentations } from './instrumentations';

describe('buildInstrumentations', () => {
  beforeEach(() => {
    mockGetNodeAutoInstrumentations.mockClear();
  });

  it('disables the fs instrumentation by default', () => {
    buildInstrumentations();

    expect(mockGetNodeAutoInstrumentations).toHaveBeenCalledWith({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    });
  });

  it('re-enables the fs instrumentation when explicitly requested', () => {
    buildInstrumentations({ enableFsInstrumentation: true });

    expect(mockGetNodeAutoInstrumentations).toHaveBeenCalledWith({
      '@opentelemetry/instrumentation-fs': { enabled: true },
    });
  });

  it('returns whatever getNodeAutoInstrumentations produces', () => {
    const instrumentations = [{ instrumentationName: 'fake' }];
    mockGetNodeAutoInstrumentations.mockReturnValueOnce(instrumentations);

    expect(buildInstrumentations()).toBe(instrumentations);
  });
});
