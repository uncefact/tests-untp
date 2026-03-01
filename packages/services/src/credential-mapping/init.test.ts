import { initBuiltInMappers } from './init';
import { getMapper, clearRegistry } from './mapper-registry';

describe('initBuiltInMappers', () => {
  beforeEach(() => {
    clearRegistry();
  });

  it('registers all 5 built-in mappers', () => {
    initBuiltInMappers();

    expect(getMapper('DigitalProductPassport', '0.6.1')).toBeDefined();
    expect(getMapper('DigitalConformityCredential', '0.6.1')).toBeDefined();
    expect(getMapper('DigitalFacilityRecord', '0.6.1')).toBeDefined();
    expect(getMapper('DigitalIdentityAnchor', '0.6.1')).toBeDefined();
    expect(getMapper('DigitalTraceabilityEvent', '0.6.1')).toBeDefined();
  });

  it('does not throw when called multiple times', () => {
    initBuiltInMappers();

    expect(() => initBuiltInMappers()).not.toThrow();
  });

  it('replaces mapper instances on repeated calls', () => {
    initBuiltInMappers();
    const first = getMapper('DigitalProductPassport', '0.6.1');

    initBuiltInMappers();
    const second = getMapper('DigitalProductPassport', '0.6.1');

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first).not.toBe(second);
  });
});
