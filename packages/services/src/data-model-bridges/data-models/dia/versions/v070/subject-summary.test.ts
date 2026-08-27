import { makeBridge } from '../../../../make-bridge.js';
import { diaV070Spec } from './index.js';
import { extractDiaSubjectSummary } from './subject-summary.js';
import { createBridgeEntities, createOrganisation } from '../../../../__fixtures__/entities.js';

describe('extractDiaSubjectSummary (v0.7.0)', () => {
  const bridge = makeBridge(diaV070Spec);

  it('reads id and registeredName from a builder-produced subject', () => {
    const subject = bridge.buildSubject(
      createBridgeEntities({
        organisation: createOrganisation({ id: 'did:web:example.com:org:1', name: 'ACME Corp' }),
      }),
    );

    expect(bridge.extractSubjectSummary(subject)).toEqual({
      id: 'did:web:example.com:org:1',
      name: 'ACME Corp',
    });
  });

  it('does not fall back to name when registeredName is absent', () => {
    expect(extractDiaSubjectSummary({ id: 'did:web:example.com:org:1', name: 'Legacy name' })).toEqual({
      id: 'did:web:example.com:org:1',
      name: undefined,
    });
  });

  it('returns nothing for an empty or non-string id or registeredName', () => {
    expect(extractDiaSubjectSummary({ id: '', registeredName: '' })).toEqual({ id: undefined, name: undefined });
    expect(extractDiaSubjectSummary({ id: 7, registeredName: ['ACME'] })).toEqual({ id: undefined, name: undefined });
  });
});
