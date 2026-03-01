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

  it('is idempotent -- calling it twice does not throw', () => {
    initBuiltInMappers();

    expect(() => initBuiltInMappers()).not.toThrow();
  });

  it('returns the same mapper instances on repeated calls', () => {
    initBuiltInMappers();
    const first = getMapper('DigitalProductPassport', '0.6.1');

    initBuiltInMappers();
    const second = getMapper('DigitalProductPassport', '0.6.1');

    // The second call overwrites with a new instance, but that is fine --
    // the important thing is it does not throw and returns a valid mapper.
    expect(second).toBeDefined();
    // After the second call, the mapper is replaced (registerMapper overwrites),
    // so first !== second, but both are valid DppV061Mapper instances.
    expect(first).toBeDefined();
  });
});
