import type { OrganisationEntity } from '../../types.js';
import { buildParty as buildPartyBase, type Party } from '../party.js';

export type PartyV070 = Party & { type: ['Party'] };

/**
 * v0.7.0's shared Party def declares a readonly `type` (default ['Party']), unlike every v0.6.x
 * Party-shaped path, which declares none -- so this wraps the version-agnostic buildParty rather
 * than changing it, keeping v0.6.x output untouched.
 */
export function buildParty(org: OrganisationEntity | undefined): PartyV070 {
  return { type: ['Party'], ...buildPartyBase(org) };
}
