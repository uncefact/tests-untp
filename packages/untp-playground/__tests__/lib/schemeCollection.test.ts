import { schemeContentHash, schemeIsTerminal, schemeTitle, schemeSubtitle } from '@/lib/schemeCollection';
import type { StoredScheme, TestStep } from '@/types';
import { TestCaseStatus, TestCaseStepId } from '../../constants';

jest.mock('@/lib/schemeValidation', () => ({
  detectSchemeVersion: jest.fn(),
}));
import { detectSchemeVersion } from '@/lib/schemeValidation';

const step = (status: TestCaseStatus): TestStep => ({
  id: TestCaseStepId.SCHEME_VERSION_DETECTION,
  name: 'x',
  status,
});

const scheme = (decoded: Record<string, unknown>, source?: StoredScheme['source']): StoredScheme => ({
  original: decoded,
  decoded,
  source,
});

describe('schemeContentHash', () => {
  it('is stable for identical content', () => {
    const doc = { id: 'x', name: 'Scheme', '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'] };
    expect(schemeContentHash(doc)).toBe(schemeContentHash({ ...doc }));
  });

  it('differs for different content', () => {
    expect(schemeContentHash({ id: 'a' })).not.toBe(schemeContentHash({ id: 'b' }));
  });

  it('differs for two documents that share a filename-worthy shape but differ in content', () => {
    // Two schemes a user might both save as scheme.json still hash differently.
    expect(schemeContentHash({ name: 'Scheme A', id: '1' })).not.toBe(schemeContentHash({ name: 'Scheme B', id: '2' }));
  });
});

describe('schemeIsTerminal', () => {
  it('is false for an empty step list', () => {
    expect(schemeIsTerminal([])).toBe(false);
  });

  it('is false while any step is pending or in progress', () => {
    expect(schemeIsTerminal([step(TestCaseStatus.SUCCESS), step(TestCaseStatus.IN_PROGRESS)])).toBe(false);
    expect(schemeIsTerminal([step(TestCaseStatus.PENDING)])).toBe(false);
  });

  it('is true when every step has settled to success or failure', () => {
    expect(schemeIsTerminal([step(TestCaseStatus.SUCCESS), step(TestCaseStatus.SUCCESS)])).toBe(true);
    expect(schemeIsTerminal([step(TestCaseStatus.SUCCESS), step(TestCaseStatus.FAILURE)])).toBe(true);
    expect(schemeIsTerminal([step(TestCaseStatus.FAILURE)])).toBe(true);
  });
});

describe('schemeTitle', () => {
  it('uses the scheme name when present', () => {
    expect(schemeTitle(scheme({ name: 'Mining Assurance Scheme' }))).toBe('Mining Assurance Scheme');
  });

  it('uses the final path segment of a url source, never the raw url', () => {
    const title = schemeTitle(scheme({}, { kind: 'url', url: 'https://s.example/schemes/mas.json' }));
    expect(title).toBe('mas.json');
    expect(title).not.toContain('https://');
  });

  it('uses the filename for a file source when there is no name', () => {
    expect(schemeTitle(scheme({}, { kind: 'file', filename: 'my-scheme.json' }))).toBe('my-scheme.json');
  });

  it('falls back to the family label when there is no name or source', () => {
    expect(schemeTitle(scheme({}))).toBe('Conformity Scheme');
  });
});

describe('schemeSubtitle', () => {
  it('shows the family label with the detected context version', () => {
    (detectSchemeVersion as jest.Mock).mockReturnValue('0.7.0');
    expect(schemeSubtitle(scheme({}))).toBe('Conformity Scheme (v0.7.0)');
  });

  it('shows the family label alone when no version is detected', () => {
    (detectSchemeVersion as jest.Mock).mockReturnValue(undefined);
    expect(schemeSubtitle(scheme({}))).toBe('Conformity Scheme');
  });
});
