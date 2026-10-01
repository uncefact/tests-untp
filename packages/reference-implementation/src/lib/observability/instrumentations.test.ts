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

  it('builds the default config: fs and pino off, pg only inside a span', () => {
    buildInstrumentations();

    expect(mockGetNodeAutoInstrumentations).toHaveBeenCalledWith({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-pino': { enabled: false },
      '@opentelemetry/instrumentation-pg': { requireParentSpan: true },
    });
  });

  it('re-enables fs on request and keeps pg only inside a span', () => {
    buildInstrumentations({ enableFsInstrumentation: true });

    expect(mockGetNodeAutoInstrumentations).toHaveBeenCalledWith({
      '@opentelemetry/instrumentation-fs': { enabled: true },
      '@opentelemetry/instrumentation-pino': { enabled: false },
      '@opentelemetry/instrumentation-pg': { requireParentSpan: true },
    });
  });

  it('returns whatever getNodeAutoInstrumentations produces', () => {
    const instrumentations = [{ instrumentationName: 'fake' }];
    mockGetNodeAutoInstrumentations.mockReturnValueOnce(instrumentations);

    expect(buildInstrumentations()).toBe(instrumentations);
  });
});
