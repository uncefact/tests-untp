import { buildParty } from './party.js';
import type { OrganisationEntity } from '../types.js';

describe('buildParty', () => {
  it('returns party with all fields when org has description and primaryIdentifier', () => {
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

  it('returns party with id and name only when org has no description or primaryIdentifier', () => {
    const org: OrganisationEntity = {
      id: 'org-2',
      name: 'Minimal Org',
    };

    const result = buildParty(org);

    expect(result).toEqual({
      id: 'org-2',
      name: 'Minimal Org',
    });
  });

  it('returns party with undefined id/name when org is undefined', () => {
    const result = buildParty(undefined);

    expect(result).toEqual({
      id: undefined,
      name: undefined,
    });
  });

  it('omits description when org.description is falsy', () => {
    const org: OrganisationEntity = {
      id: 'org-3',
      name: 'No Description',
      description: '',
    };

    const result = buildParty(org);

    expect(result.description).toBeUndefined();
  });

  it('omits registeredId/idScheme when org.primaryIdentifier is null', () => {
    const org: OrganisationEntity = {
      id: 'org-4',
      name: 'No Identifier',
      primaryIdentifier: null,
    };

    const result = buildParty(org);

    expect(result.registeredId).toBeUndefined();
    expect(result.idScheme).toBeUndefined();
  });
});
