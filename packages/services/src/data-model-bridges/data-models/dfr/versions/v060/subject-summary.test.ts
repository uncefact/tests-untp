import { makeBridge } from '../../../../make-bridge.js';
import { dfrV060Spec } from './index.js';
import { dfrV061Spec } from '../v061/index.js';
import { extractDfrSubjectSummary } from './subject-summary.js';
import {
  createBridgeEntities,
  createFacility,
  createOrganisation,
  createProduct,
} from '../../../../__fixtures__/entities.js';
import type { VersionSpec } from '../../../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dfrV060Spec],
  ['v0.6.1', dfrV061Spec],
];

describe.each(versions)('extractDfrSubjectSummary (%s)', (_version, spec) => {
  const bridge = makeBridge(spec);

  it('reads facility.id and facility.name from a builder-produced subject', () => {
    const subject = bridge.buildSubject(
      createBridgeEntities({
        facility: createFacility({ id: 'did:web:example.com:facility:1', name: 'My Facility' }),
      }),
    );

    expect(bridge.extractSubjectSummary(subject)).toEqual({
      id: 'did:web:example.com:facility:1',
      name: 'My Facility',
    });
  });

  it('does not use top-level id or name when a nested facility is present', () => {
    expect(
      extractDfrSubjectSummary({
        id: 'top-level-id',
        name: 'top-level-name',
        facility: { id: 'facility-id', name: 'facility-name' },
      }),
    ).toEqual({ id: 'facility-id', name: 'facility-name' });
  });

  it('does not fall back to organisation or product names when the facility has no name', () => {
    const subject = bridge.buildSubject(
      createBridgeEntities({
        facility: createFacility({ id: 'did:web:example.com:facility:1', name: undefined }),
        organisation: createOrganisation({ name: 'Org Name' }),
        product: createProduct({ name: 'Product Name' }),
      }),
    );

    expect(bridge.extractSubjectSummary(subject)).toEqual({
      id: 'did:web:example.com:facility:1',
      name: undefined,
    });
  });

  it('returns no subject when facility is missing', () => {
    expect(extractDfrSubjectSummary({ type: ['FacilityRecord'] })).toEqual({ id: undefined, name: undefined });
  });

  it('returns no subject when facility is null', () => {
    expect(extractDfrSubjectSummary({ facility: null })).toEqual({ id: undefined, name: undefined });
  });

  it('returns no subject when facility is not a single object', () => {
    expect(extractDfrSubjectSummary({ facility: 'not-an-object' })).toEqual({ id: undefined, name: undefined });
    expect(extractDfrSubjectSummary({ facility: [{ id: 'f-1', name: 'Nested' }] })).toEqual({
      id: undefined,
      name: undefined,
    });
  });

  it('returns nothing for an empty or non-string facility id or name', () => {
    expect(extractDfrSubjectSummary({ facility: { id: '', name: '' } })).toEqual({ id: undefined, name: undefined });
    expect(extractDfrSubjectSummary({ facility: { id: 7, name: ['Shed'] } })).toEqual({
      id: undefined,
      name: undefined,
    });
  });
});
