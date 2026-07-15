import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef } from 'react';
import { SchemeTestResults } from '@/components/SchemeTestResults';
import { useArtefactCollection } from '@/hooks/useArtefactCollection';
import { upsert } from '@/lib/artefactCollection';
import { schemeContentHash } from '@/lib/schemeCollection';
import { newId } from '@/lib/id';
import { detectSchemeVersion, validateSchemeSchema } from '@/lib/schemeValidation';
import { validateContext } from '@/lib/contextValidation';
import type { StoredScheme, TestStep } from '@/types';

jest.mock('canvas-confetti', () => jest.fn());
jest.mock('@/components/TestResults', () => ({ confettiConfig: {}, TestResults: () => null }));
jest.mock('@/lib/schemeValidation', () => ({
  ...jest.requireActual('@/lib/schemeValidation'),
  detectSchemeVersion: jest.fn(),
  validateSchemeSchema: jest.fn(),
}));
jest.mock('@/lib/contextValidation', () => ({ validateContext: jest.fn() }));

const scheme = (decoded: Record<string, unknown>, source?: StoredScheme['source']): StoredScheme => ({
  original: decoded,
  decoded,
  source,
});

// Harness: drives the real collection hook so the pipeline runs and the cards re-render on commit.
function Harness({ schemes }: { schemes: StoredScheme[] }) {
  const collection = useArtefactCollection<StoredScheme, TestStep[]>();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    for (const s of schemes) {
      collection.dispatch((state) =>
        upsert(state, { payload: s, contentHash: schemeContentHash(s.decoded), mintInstanceId: newId }),
      );
    }
  }, [schemes, collection]);
  return <SchemeTestResults collection={collection.state} dispatch={collection.dispatch} />;
}

beforeEach(() => {
  jest.clearAllMocks();
  (detectSchemeVersion as jest.Mock).mockReturnValue('0.7.0');
  (validateSchemeSchema as jest.Mock).mockResolvedValue({ valid: true });
  (validateContext as jest.Mock).mockResolvedValue({ valid: true });
});

describe('SchemeTestResults', () => {
  it('renders one card per instance in upload order', async () => {
    render(<Harness schemes={[scheme({ id: 'a', name: 'Alpha Scheme' }), scheme({ id: 'b', name: 'Beta Scheme' })]} />);

    const titles = await screen.findAllByRole('heading', { level: 3 });
    expect(titles.map((h) => h.textContent)).toEqual(['Alpha Scheme', 'Beta Scheme']);
  });

  it('shows the always-on family subtitle with the detected version, even for a nameless scheme', async () => {
    render(<Harness schemes={[scheme({ id: 'x' }, { kind: 'file', filename: 'x.json' })]} />);

    expect(await screen.findByText('Conformity Scheme (v0.7.0)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('x.json');
  });

  it('uses the scheme name as the title when present', async () => {
    render(<Harness schemes={[scheme({ id: 'x', name: 'Mining Assurance' })]} />);
    expect(await screen.findByRole('heading', { level: 3, name: 'Mining Assurance' })).toBeInTheDocument();
  });

  it('surfaces the unchanged version-detection failure copy and exactly two skipped steps', async () => {
    (detectSchemeVersion as jest.Mock).mockReturnValue(undefined);
    render(<Harness schemes={[scheme({ id: 'x', name: 'No Context Scheme' })]} />);

    await userEvent.click(await screen.findByTestId('scheme-group-header'));

    expect(await screen.findByText(/Could not detect a UNTP version from the @context/)).toBeInTheDocument();
    // Both the schema-validation and context-validation steps are skipped.
    expect(screen.getAllByText('Skipped: version detection failed.')).toHaveLength(2);
  });

  it('removes a card only after the confirmation dialog is confirmed', async () => {
    render(<Harness schemes={[scheme({ id: 'x', name: 'Removable Scheme' })]} />);
    expect(await screen.findByRole('heading', { level: 3, name: 'Removable Scheme' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Removable Scheme' }));
    expect(await screen.findByText('Remove Removable Scheme?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(screen.queryByRole('heading', { level: 3, name: 'Removable Scheme' })).not.toBeInTheDocument();
    });
  });

  it('keeps the card when the removal is cancelled', async () => {
    render(<Harness schemes={[scheme({ id: 'x', name: 'Keep Me' })]} />);
    await screen.findByRole('heading', { level: 3, name: 'Keep Me' });

    await userEvent.click(screen.getByRole('button', { name: 'Remove Keep Me' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('heading', { level: 3, name: 'Keep Me' })).toBeInTheDocument();
  });
});
