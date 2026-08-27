import { makeBridge } from '../../../../make-bridge.js';
import { dppV060Spec } from './index.js';
import { dppV061Spec } from '../v061/index.js';
import { extractDppSubjectSummary } from './subject-summary.js';
import {
  createBridgeEntities,
  createProduct,
  createFacility,
  createOrganisation,
} from '../../../../__fixtures__/entities.js';
import type { VersionSpec } from '../../../../types.js';

const versions: [string, VersionSpec][] = [
  ['v0.6.0', dppV060Spec],
  ['v0.6.1', dppV061Spec],
];

describe.each(versions)('extractDppSubjectSummary (%s)', (_version, spec) => {
  const bridge = makeBridge(spec);

  it('reads product.id and product.name from a builder-produced subject', () => {
    const subject = bridge.buildSubject(
      createBridgeEntities({
        product: createProduct({ id: 'did:web:example.com:product:1', name: 'My Product' }),
      }),
    );

    expect(bridge.extractSubjectSummary(subject)).toEqual({
      id: 'did:web:example.com:product:1',
      name: 'My Product',
    });
  });

  it('does not use top-level id or name when a nested product is present', () => {
    expect(
      extractDppSubjectSummary({
        id: 'top-level-id',
        name: 'top-level-name',
        product: { id: 'product-id', name: 'product-name' },
      }),
    ).toEqual({ id: 'product-id', name: 'product-name' });
  });

  it('does not fall back to facility or organisation names when the product has no name', () => {
    const subject = bridge.buildSubject(
      createBridgeEntities({
        product: createProduct({ id: 'did:web:example.com:product:1', name: undefined }),
        facility: createFacility({ name: 'Facility Name' }),
        organisation: createOrganisation({ name: 'Org Name' }),
      }),
    );

    expect(bridge.extractSubjectSummary(subject)).toEqual({
      id: 'did:web:example.com:product:1',
      name: undefined,
    });
  });

  it('returns no subject when product is missing', () => {
    expect(extractDppSubjectSummary({ type: ['ProductPassport'] })).toEqual({ id: undefined, name: undefined });
  });

  it('returns no subject when product is null', () => {
    expect(extractDppSubjectSummary({ product: null })).toEqual({ id: undefined, name: undefined });
  });

  it('returns no subject when product is not a single object', () => {
    expect(extractDppSubjectSummary({ product: 'not-an-object' })).toEqual({ id: undefined, name: undefined });
    expect(extractDppSubjectSummary({ product: [{ id: 'p-1', name: 'Nested' }] })).toEqual({
      id: undefined,
      name: undefined,
    });
  });

  it('returns nothing for an empty or non-string product id or name', () => {
    expect(extractDppSubjectSummary({ product: { id: '', name: '' } })).toEqual({ id: undefined, name: undefined });
    expect(extractDppSubjectSummary({ product: { id: 7, name: ['Widget'] } })).toEqual({
      id: undefined,
      name: undefined,
    });
  });
});
