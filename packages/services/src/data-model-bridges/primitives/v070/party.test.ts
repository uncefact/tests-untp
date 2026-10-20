import { buildParty } from './party.js';
import type { OrganisationEntity } from '../../types.js';

describe('buildParty (v0.7.0)', () => {
  it("adds type: ['Party'] on top of the base buildParty output", () => {
    const org: OrganisationEntity = {
      id: 'org-1',
      name: 'Test Organisation',
      description: 'A test org',
      primaryIdentifier: {
        value: '1234567890',
        scheme: { id: 'scheme-1', name: 'GLN' },
      },
    };

    const result = buildParty(org);

    expect(result).toEqual({
      type: ['Party'],
      id: 'org-1',
      name: 'Test Organisation',
      description: 'A test org',
      registeredId: '1234567890',
      idScheme: {
        type: ['IdentifierScheme'],
        id: 'scheme-1',
        name: 'GLN',
      },
    });
  });

  it('includes type even when org is undefined', () => {
    const result = buildParty(undefined);

    expect(result).toEqual({
      type: ['Party'],
      id: undefined,
      name: undefined,
    });
  });
});
