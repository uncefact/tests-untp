import { getBridge, listBridgeVersions } from './bridge-registry.js';
import type { CredentialSubjectInput, SubjectSummary } from './types.js';

/**
 * What every registered bridge reports as a credential's subject, one case per
 * data model and version.
 *
 * The subjects here follow each version's published UNTP schema, which is what
 * issuance actually receives: a caller submits its own payload, and this
 * system's builders may have had no part in producing it. A version that moves
 * its identifying fields (as DIA did in 0.7.0, renaming `name` to
 * `registeredName`) or nests them (as the 0.6 passport and facility record do)
 * fails here rather than silently recording a blank subject.
 */
type Case = { subject: CredentialSubjectInput; expected: SubjectSummary };

const PRODUCT_PASSPORT_0_6: Case = {
  // The 0.6 passport wraps the product, and carries its own id for the
  // passport. The row describes the product, never the wrapper.
  subject: {
    type: ['ProductPassport'],
    id: 'example:passport/1234',
    product: { type: ['Product'], id: 'https://id.gs1.org/01/09520123456788/21/12345', name: 'EV battery 300Ah' },
  },
  expected: { id: 'https://id.gs1.org/01/09520123456788/21/12345', name: 'EV battery 300Ah' },
};

const FACILITY_RECORD_0_6: Case = {
  subject: {
    type: ['FacilityRecord'],
    id: 'example:facility-record/1',
    facility: { type: ['Facility'], id: 'https://id.gs1.org/414/1321202290648', name: 'Greenacres battery factory' },
  },
  expected: { id: 'https://id.gs1.org/414/1321202290648', name: 'Greenacres battery factory' },
};

const CONFORMITY_ATTESTATION: Case = {
  subject: {
    type: ['ConformityAttestation'],
    id: 'https://sample-certifiers.com/attestations/12345',
    name: 'Carbon Lifecycle assessment 12345567',
  },
  expected: { id: 'https://sample-certifiers.com/attestations/12345', name: 'Carbon Lifecycle assessment 12345567' },
};

const REGISTERED_IDENTITY_0_6: Case = {
  subject: { type: ['Party'], id: 'did:web:samplecompany.com/123456789', name: 'Sample business Ltd' },
  expected: { id: 'did:web:samplecompany.com/123456789', name: 'Sample business Ltd' },
};

const TRACEABILITY_EVENTS_0_6: Case = {
  // 0.6 events carry no name in the schema, so there is nothing to read for
  // one. Several events are permitted; the row describes the first.
  subject: [
    { type: ['Event'], id: 'https://events.example.com/first' },
    { type: ['Event'], id: 'https://events.example.com/second' },
  ],
  expected: { id: 'https://events.example.com/first', name: undefined },
};

const CASES: Record<string, Record<string, Case>> = {
  DigitalProductPassport: {
    '0.6.0': PRODUCT_PASSPORT_0_6,
    '0.6.1': PRODUCT_PASSPORT_0_6,
    '0.7.0': {
      // In 0.7.0 the subject is the Product itself.
      subject: {
        type: ['Product'],
        id: 'https://id.sample-mine.example.com/product/cu-conc-2025',
        name: 'Copper Concentrate (Cu 30%)',
      },
      expected: {
        id: 'https://id.sample-mine.example.com/product/cu-conc-2025',
        name: 'Copper Concentrate (Cu 30%)',
      },
    },
  },
  DigitalConformityCredential: {
    '0.6.0': CONFORMITY_ATTESTATION,
    '0.6.1': CONFORMITY_ATTESTATION,
    '0.7.0': CONFORMITY_ATTESTATION,
  },
  DigitalFacilityRecord: {
    '0.6.0': FACILITY_RECORD_0_6,
    '0.6.1': FACILITY_RECORD_0_6,
    '0.7.0': {
      // In 0.7.0 the subject is the Facility itself.
      subject: {
        type: ['Facility'],
        id: 'https://id.gs1.org/414/1321202290648',
        name: 'Greenacres battery factory',
      },
      expected: { id: 'https://id.gs1.org/414/1321202290648', name: 'Greenacres battery factory' },
    },
  },
  DigitalIdentityAnchor: {
    '0.6.0': REGISTERED_IDENTITY_0_6,
    '0.6.1': REGISTERED_IDENTITY_0_6,
    '0.7.0': {
      // 0.7.0 renamed the display field. The stray `name` proves the rename is
      // read rather than fallen back from.
      subject: {
        type: ['RegisteredIdentity'],
        id: 'did:web:samplecompany.com/123456789',
        registeredName: 'Sample business Ltd',
        name: 'not the registered name',
      },
      expected: { id: 'did:web:samplecompany.com/123456789', name: 'Sample business Ltd' },
    },
  },
  DigitalTraceabilityEvent: {
    '0.6.0': TRACEABILITY_EVENTS_0_6,
    '0.6.1': TRACEABILITY_EVENTS_0_6,
    '0.7.0': {
      subject: [
        {
          type: ['TraceabilityEvent'],
          id: 'https://sample-mine.example.com/events/move-conc-2025-0301',
          name: 'Copper concentrate shipment to Sample',
        },
        { type: ['TraceabilityEvent'], id: 'https://sample-mine.example.com/events/move-conc-2025-0302' },
      ],
      expected: {
        id: 'https://sample-mine.example.com/events/move-conc-2025-0301',
        name: 'Copper concentrate shipment to Sample',
      },
    },
  },
};

describe('extractSubjectSummary across every registered bridge', () => {
  it.each(listBridgeVersions())('$dataModelType $version', ({ dataModelType, version }) => {
    const testCase = CASES[dataModelType]?.[version];
    // A registered bridge with no case here is the failure this asserts: a new
    // version must state what its subject is before it can be issued.
    expect(testCase).toBeDefined();

    const bridge = getBridge(dataModelType, version);
    expect(bridge).toBeDefined();
    expect(bridge?.extractSubjectSummary(testCase!.subject)).toEqual(testCase!.expected);
  });

  it('has no case for a bridge the registry does not hold', () => {
    const registered = new Set(listBridgeVersions().map((b) => `${b.dataModelType} ${b.version}`));
    const cased = Object.entries(CASES).flatMap(([type, versions]) =>
      Object.keys(versions).map((version) => `${type} ${version}`),
    );
    expect(cased.filter((key) => !registered.has(key))).toEqual([]);
  });
});
