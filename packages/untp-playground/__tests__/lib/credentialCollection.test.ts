import {
  credentialContentHash,
  credentialGroupLabel,
  credentialGroupType,
  credentialIsTerminal,
  credentialSubtitle,
  credentialTitle,
  credentialTypeLabel,
  instanceStatus,
  worstStatus,
} from '@/lib/credentialCollection';
import type { Credential, StoredCredential, TestStep } from '@/types';
import { TestCaseStatus, TestCaseStepId, VCDM_CONTEXT_URLS } from '../../constants';

const step = (status: TestCaseStatus): TestStep => ({
  id: TestCaseStepId.VCDM_VERSION,
  name: 'x',
  status,
});

const credential = (decoded: Credential, source?: StoredCredential['source']): StoredCredential => ({
  original: decoded,
  decoded,
  source,
});

const dppDoc = (extra: Record<string, unknown> = {}) => ({
  '@context': [VCDM_CONTEXT_URLS.v2, 'https://vocabulary.uncefact.org/untp/dpp/0.6.0/context.jsonld'],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
  ...extra,
});

describe('credentialContentHash', () => {
  it('is stable for identical content', () => {
    const doc = dppDoc({ id: 'x' });
    expect(credentialContentHash(doc)).toBe(credentialContentHash({ ...doc }));
  });

  it('is invariant to key order, so a re-serialised document is still one instance', () => {
    expect(credentialContentHash({ id: 'x', type: ['a'], meta: { a: 1, b: 2 } })).toBe(
      credentialContentHash({ meta: { b: 2, a: 1 }, type: ['a'], id: 'x' }),
    );
  });

  it('differs for different content', () => {
    expect(credentialContentHash(dppDoc({ id: 'a' }))).not.toBe(credentialContentHash(dppDoc({ id: 'b' })));
  });
});

describe('credentialIsTerminal', () => {
  it('is false for an empty step list', () => {
    expect(credentialIsTerminal([])).toBe(false);
  });

  it('is false while any step is pending or in progress', () => {
    expect(credentialIsTerminal([step(TestCaseStatus.SUCCESS), step(TestCaseStatus.IN_PROGRESS)])).toBe(false);
    expect(credentialIsTerminal([step(TestCaseStatus.PENDING)])).toBe(false);
  });

  it('is true when every step has settled to success or failure', () => {
    expect(credentialIsTerminal([step(TestCaseStatus.SUCCESS), step(TestCaseStatus.SUCCESS)])).toBe(true);
    expect(credentialIsTerminal([step(TestCaseStatus.SUCCESS), step(TestCaseStatus.FAILURE)])).toBe(true);
    expect(credentialIsTerminal([step(TestCaseStatus.FAILURE)])).toBe(true);
  });

  it('is true when a step has settled to warning, matching the report-readiness gate (TERMINAL_STATUSES)', () => {
    expect(credentialIsTerminal([step(TestCaseStatus.SUCCESS), step(TestCaseStatus.WARNING)])).toBe(true);
  });
});

describe('credentialGroupType', () => {
  it('detects the core UNTP type for a plain credential', () => {
    expect(credentialGroupType(dppDoc())).toBe('DigitalProductPassport');
  });

  it('resolves to the extension core type when the document is a known extension', () => {
    // DigitalLivestockPassport v0.4.0 resolves to a DigitalProductPassport v0.5.0 core (schemaValidation.ts).
    const doc = {
      '@context': [VCDM_CONTEXT_URLS.v2, 'https://aatp.foodagility.com/0.4.0/context.jsonld'],
      type: ['VerifiableCredential', 'DigitalLivestockPassport'],
    };
    expect(credentialGroupType(doc)).toBe('DigitalProductPassport');
  });

  it('returns Unknown for a document with no recognised UNTP type', () => {
    expect(credentialGroupType({ '@context': [VCDM_CONTEXT_URLS.v2], type: ['VerifiableCredential'] })).toBe('Unknown');
  });
});

describe('credentialTypeLabel', () => {
  it('splits a PascalCase type into spaced words', () => {
    expect(credentialTypeLabel('DigitalProductPassport')).toBe('Digital Product Passport');
    expect(credentialTypeLabel('DigitalConformityCredential')).toBe('Digital Conformity Credential');
  });
});

describe('credentialGroupLabel', () => {
  it('uses the singular label for a single instance', () => {
    expect(credentialGroupLabel('DigitalProductPassport', 1)).toBe('Digital Product Passport');
  });

  it('pluralises the label for more than one instance', () => {
    expect(credentialGroupLabel('DigitalProductPassport', 2)).toBe('Digital Product Passports');
    expect(credentialGroupLabel('DigitalConformityCredential', 3)).toBe('Digital Conformity Credentials');
  });
});

describe('credentialTitle', () => {
  it('uses the final path segment of a url source, never the raw url', () => {
    const title = credentialTitle(credential(dppDoc(), { kind: 'url', url: 'https://c.example/credentials/dpp.json' }));
    expect(title).toBe('dpp.json');
    expect(title).not.toContain('https://');
  });

  it('uses the filename for a file source', () => {
    expect(credentialTitle(credential(dppDoc(), { kind: 'file', filename: 'my-dpp.json' }))).toBe('my-dpp.json');
  });

  it('falls back to the spaced detected type when there is no source', () => {
    expect(credentialTitle(credential(dppDoc()))).toBe('Digital Product Passport');
  });
});

describe('credentialSubtitle', () => {
  it('shows the detected version and issuer for a file-sourced instance', () => {
    const doc = dppDoc({ issuer: { id: 'did:web:acme.example' } });
    expect(credentialSubtitle(credential(doc, { kind: 'file', filename: 'dpp.json' }))).toBe(
      'v0.6.0 · did:web:acme.example',
    );
  });

  it('supports a plain string issuer', () => {
    const doc = dppDoc({ issuer: 'did:web:acme.example' });
    expect(credentialSubtitle(credential(doc))).toBe('v0.6.0 · did:web:acme.example');
  });

  it('puts the source host first for a url-sourced instance', () => {
    const doc = dppDoc({ issuer: { id: 'did:web:volt.example' } });
    const subtitle = credentialSubtitle(
      credential(doc, { kind: 'url', url: 'https://credentials.example.org/dpp-battery.json' }),
    );
    expect(subtitle).toBe('credentials.example.org · v0.6.0 · did:web:volt.example');
  });

  it('shows "unknown version" when no UNTP version is detected, and omits a missing issuer', () => {
    const doc = { '@context': [VCDM_CONTEXT_URLS.v2], type: ['VerifiableCredential', 'DigitalProductPassport'] };
    expect(credentialSubtitle(credential(doc))).toBe('unknown version');
  });

  it('names the detected extension (type and version) rather than only the core version', () => {
    // DigitalLivestockPassport v0.4.0 groups under DigitalProductPassport, but the row names the
    // extension so the user can see which extension was validated (schemaValidation.ts).
    const doc = {
      '@context': [VCDM_CONTEXT_URLS.v2, 'https://aatp.foodagility.com/0.4.0/context.jsonld'],
      type: ['VerifiableCredential', 'DigitalLivestockPassport'],
      issuer: { id: 'did:web:farm.example' },
    };
    expect(credentialSubtitle(credential(doc, { kind: 'file', filename: 'dlp.json' }))).toBe(
      'DigitalLivestockPassport v0.4.0 · did:web:farm.example',
    );
  });
});

describe('worstStatus', () => {
  it('is pending for an empty list', () => {
    expect(worstStatus([])).toBe(TestCaseStatus.PENDING);
  });

  it('is success when every status is success', () => {
    expect(worstStatus([TestCaseStatus.SUCCESS, TestCaseStatus.SUCCESS])).toBe(TestCaseStatus.SUCCESS);
  });

  it('is in progress when any status is pending or in progress and none has failed', () => {
    expect(worstStatus([TestCaseStatus.SUCCESS, TestCaseStatus.IN_PROGRESS])).toBe(TestCaseStatus.IN_PROGRESS);
    expect(worstStatus([TestCaseStatus.SUCCESS, TestCaseStatus.PENDING])).toBe(TestCaseStatus.IN_PROGRESS);
  });

  it('is failure when any status has failed, regardless of other statuses', () => {
    expect(worstStatus([TestCaseStatus.SUCCESS, TestCaseStatus.IN_PROGRESS, TestCaseStatus.FAILURE])).toBe(
      TestCaseStatus.FAILURE,
    );
  });
});

describe('instanceStatus', () => {
  it('is pending before a run has produced any steps', () => {
    expect(instanceStatus(undefined)).toBe(TestCaseStatus.PENDING);
    expect(instanceStatus([])).toBe(TestCaseStatus.PENDING);
  });

  it('reduces a step list to the worst status', () => {
    expect(instanceStatus([step(TestCaseStatus.SUCCESS), step(TestCaseStatus.FAILURE)])).toBe(TestCaseStatus.FAILURE);
    expect(instanceStatus([step(TestCaseStatus.SUCCESS), step(TestCaseStatus.IN_PROGRESS)])).toBe(
      TestCaseStatus.IN_PROGRESS,
    );
    expect(instanceStatus([step(TestCaseStatus.SUCCESS)])).toBe(TestCaseStatus.SUCCESS);
  });
});
