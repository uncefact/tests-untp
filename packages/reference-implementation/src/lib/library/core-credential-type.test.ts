import { listRegisteredVersions } from '@uncefact/untp-ri-services/data-model-bridges';
import { CoreCredentialType } from '@/lib/prisma/generated';
import { bridgeNameOf, coreCredentialTypeFromTypes, coreCredentialTypeOf } from './core-credential-type';

describe('core credential type mapping', () => {
  it.each([
    [CoreCredentialType.DPP, 'DigitalProductPassport'],
    [CoreCredentialType.DCC, 'DigitalConformityCredential'],
    [CoreCredentialType.DFR, 'DigitalFacilityRecord'],
    [CoreCredentialType.DTE, 'DigitalTraceabilityEvent'],
    [CoreCredentialType.DIA, 'DigitalIdentityAnchor'],
  ])('maps %s to %s and back', (code, bridgeName) => {
    expect(bridgeNameOf(code)).toBe(bridgeName);
    expect(coreCredentialTypeOf(bridgeName)).toBe(code);
  });

  it('covers every member of the enum', () => {
    for (const code of Object.values(CoreCredentialType)) {
      expect(coreCredentialTypeOf(bridgeNameOf(code))).toBe(code);
    }
  });

  it('knows no other names', () => {
    expect(coreCredentialTypeOf('VerifiableCredential')).toBeUndefined();
    expect(coreCredentialTypeOf('dpp')).toBeUndefined();
  });

  it('names the one core type a type set contains, wherever it sits and however often', () => {
    expect(
      coreCredentialTypeFromTypes(['VerifiableCredential', 'DigitalLivestockPassport', 'DigitalProductPassport']),
    ).toBe(CoreCredentialType.DPP);
    expect(coreCredentialTypeFromTypes(['DigitalProductPassport', 'DigitalProductPassport'])).toBe(
      CoreCredentialType.DPP,
    );
    expect(coreCredentialTypeFromTypes('DigitalFacilityRecord')).toBe(CoreCredentialType.DFR);
  });

  it("answers 'none' for a type set naming no core type", () => {
    expect(coreCredentialTypeFromTypes(['VerifiableCredential', 'DigitalLivestockPassport'])).toBe('none');
    expect(coreCredentialTypeFromTypes(['VerifiableCredential', 42, null])).toBe('none');
    expect(coreCredentialTypeFromTypes(undefined)).toBe('none');
    expect(coreCredentialTypeFromTypes([])).toBe('none');
  });

  it("answers 'ambiguous' for a type set naming two core types, rather than guessing between them", () => {
    expect(
      coreCredentialTypeFromTypes(['VerifiableCredential', 'DigitalConformityCredential', 'DigitalProductPassport']),
    ).toBe('ambiguous');
    expect(
      coreCredentialTypeFromTypes(['DigitalProductPassport', 'DigitalFacilityRecord', 'DigitalIdentityAnchor']),
    ).toBe('ambiguous');
  });

  it("distinguishes 'none' from 'ambiguous', so a caller can tell a fallback from a refusal", () => {
    expect(coreCredentialTypeFromTypes(['Whatever'])).not.toBe('ambiguous');
    expect(coreCredentialTypeFromTypes(['DigitalProductPassport', 'DigitalFacilityRecord'])).not.toBe('none');
  });

  /**
   * The names this map produces are the data-model bridge registry's keys, in
   * another package. Renaming a key there without renaming it here would
   * leave every lookup returning undefined at runtime with both packages'
   * own suites green, so the two are held together: a name this map yields
   * must be a registered type, and all five must be.
   */
  it('yields a bridge name the services registry actually holds, for every core type', () => {
    const registered = Object.values(CoreCredentialType).filter(
      (code) => listRegisteredVersions(bridgeNameOf(code)).length > 0,
    );

    expect(registered).toEqual(Object.values(CoreCredentialType));
    expect(registered).toHaveLength(5);
  });

  it('yields no bridge name for a string the registry does not hold', () => {
    // The other direction of the same pin: the check above only means
    // something while an unregistered name really does come back empty.
    expect(listRegisteredVersions('DigitalLivestockPassport')).toEqual([]);
  });
});
