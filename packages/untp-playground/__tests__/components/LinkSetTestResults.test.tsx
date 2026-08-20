import { LinkSetTestResults } from '@/components/LinkSetTestResults';
import { useArtefactCollection } from '@/hooks/useArtefactCollection';
import { upsert } from '@/lib/artefactCollection';
import { linkSetKey } from '@/lib/linkSetCollection';
import { newId } from '@/lib/id';
import type { StoredLinkSet, TestStep } from '@/types';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { useEffect } from 'react';

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

const LINK_SET = {
  linkset: [
    {
      anchor: 'https://id.example.org/01/09520123456788',
      'https://test.uncefact.org/voc/untp/dpp': [
        { href: 'https://x.example.org/creds/dpp.json', title: 'Digital Product Passport' },
      ],
      'https://ref.gs1.org/voc/certificationInfo': [
        { href: 'https://x.example.org/creds/dcc.json', type: 'application/vc+jwt' },
      ],
      pip: [{ href: 'https://products.example.org/1', type: 'text/html', title: 'Product page' }],
    },
  ],
};

function Harness({ initial, reingest }: { initial: Array<{ payload: StoredLinkSet }>; reingest?: StoredLinkSet }) {
  const linkSet = useArtefactCollection<StoredLinkSet, TestStep[]>();
  useEffect(() => {
    for (const entry of initial) {
      linkSet.dispatch((state) =>
        upsert(state, { payload: entry.payload, contentHash: linkSetKey(entry.payload.source), mintInstanceId: newId }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <>
      {reingest && (
        <button
          data-testid='harness-reingest'
          onClick={() =>
            linkSet.dispatch((state) =>
              upsert(state, { payload: reingest, contentHash: linkSetKey(reingest.source), mintInstanceId: newId }),
            )
          }
        >
          Re-ingest
        </button>
      )}
      <LinkSetTestResults collection={linkSet.state} dispatch={linkSet.dispatch} />
    </>
  );
}

const storedLinkSet = (source: StoredLinkSet['source']): StoredLinkSet => ({
  original: LINK_SET,
  decoded: LINK_SET,
  source,
});

describe('LinkSetTestResults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('settles a fresh link set immediately with the pending stub step, never a spinner', async () => {
    render(
      <Harness
        initial={[{ payload: storedLinkSet({ kind: 'url', url: 'https://r.example.org/01/1?linkType=all' }) }]}
      />,
    );

    const header = await screen.findByTestId('linkset-card-header');
    // The stub settles the instance instantly: the card shows the quiet pending state, not the
    // in-progress spinner, and the pending step is visible when expanded.
    expect(screen.queryAllByTestId(/status-icon-in-progress/)).toHaveLength(0);
    expect(screen.getAllByTestId(/status-icon-pending/).length).toBeGreaterThan(0);

    fireEvent.click(header);
    expect(screen.getByText('Schema Validation')).toBeInTheDocument();
    // The pending stub explains itself, so grey reads as "not built yet" rather than "stuck".
    expect(screen.getByTestId('linkset-validation-note')).toHaveTextContent(
      'not yet run: link set validation is coming in v0.4',
    );
  });

  it('titles a resolved card by the scheme-stripped URL and shows the full URL in the source caption', async () => {
    render(
      <Harness
        initial={[{ payload: storedLinkSet({ kind: 'url', url: 'https://r.example.org/01/1?linkType=all' }) }]}
      />,
    );

    const header = await screen.findByTestId('linkset-card-header');
    expect(screen.getByText('r.example.org/01/1')).toBeInTheDocument();
    expect(screen.getByText('Link Set')).toBeInTheDocument();

    fireEvent.click(header);
    expect(screen.getByText(/https:\/\/r\.example\.org\/01\/1\?linkType=all/)).toBeInTheDocument();
  });

  it('lists only UNTP credential links, and counts the other links with a docs pointer', async () => {
    render(
      <Harness
        initial={[{ payload: storedLinkSet({ kind: 'url', url: 'https://r.example.org/01/1?linkType=all' }) }]}
      />,
    );

    fireEvent.click(await screen.findByTestId('linkset-card-header'));

    // The dpp relation and the vc media type qualify; the pip product page does not.
    expect(screen.getByText('Linked credentials · 2')).toBeInTheDocument();
    const rows = screen.getAllByTestId('linked-credential-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Digital Product Passport');
    expect(rows[1]).toHaveTextContent('dcc.json');

    const note = screen.getByTestId('other-links-note');
    expect(note).toHaveTextContent('1 other link in this link set is not identified as a UNTP credential.');
    expect(note.querySelector('a')).toHaveAttribute(
      'href',
      expect.stringContaining('identifying-untp-credential-links'),
    );
  });

  it('says when no UNTP credential links were found among the links', async () => {
    const productOnly: StoredLinkSet = {
      original: {},
      decoded: {
        linkset: [
          {
            anchor: 'https://id.example.org/01/2',
            'https://ref.gs1.org/voc/hasRetailers': [
              { href: 'https://shops.example.org/a', type: 'text/html' },
              { href: 'https://shops.example.org/b', type: 'text/html' },
            ],
          },
        ],
      },
      source: { kind: 'url', url: 'https://r.example.org/01/2?linkType=all' },
    };
    render(<Harness initial={[{ payload: productOnly }]} />);

    fireEvent.click(await screen.findByTestId('linkset-card-header'));

    expect(screen.queryByTestId('linked-credential-row')).not.toBeInTheDocument();
    expect(screen.getByTestId('other-links-note')).toHaveTextContent(
      'No UNTP credential links found. 2 other links in this link set are not identified as UNTP credentials.',
    );
  });

  it('removes without a confirm dialog, and the toast Undo restores the card', async () => {
    render(
      <Harness
        initial={[{ payload: storedLinkSet({ kind: 'url', url: 'https://r.example.org/01/1?linkType=all' }) }]}
      />,
    );

    fireEvent.click(await screen.findByLabelText('Remove r.example.org/01/1'));

    await waitFor(() => {
      expect(screen.queryByTestId('linkset-card-header')).not.toBeInTheDocument();
    });
    expect(toast.success).toHaveBeenCalledWith(
      'Removed r.example.org/01/1',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
    );

    // Fire the toast's Undo action: the card returns.
    const action = (toast.success as jest.Mock).mock.calls[0][1].action;
    act(() => action.onClick());
    expect(await screen.findByTestId('linkset-card-header')).toBeInTheDocument();
  });

  it('restores an undone card at its original position in a multi-item list', async () => {
    const sources = [
      { kind: 'url', url: 'https://r.example.org/01/first?linkType=all' },
      { kind: 'url', url: 'https://r.example.org/01/middle?linkType=all' },
      { kind: 'url', url: 'https://r.example.org/01/last?linkType=all' },
    ] as const;
    render(<Harness initial={sources.map((source) => ({ payload: storedLinkSet(source) }))} />);

    const titlesInOrder = () =>
      [...document.querySelectorAll('[data-testid="linkset-card-header"] h3')].map((el) => el.textContent);

    await screen.findAllByTestId('linkset-card-header');
    expect(titlesInOrder()).toEqual(['r.example.org/01/first', 'r.example.org/01/middle', 'r.example.org/01/last']);

    fireEvent.click(screen.getByLabelText('Remove r.example.org/01/middle'));
    await waitFor(() => {
      expect(titlesInOrder()).toEqual(['r.example.org/01/first', 'r.example.org/01/last']);
    });

    const action = (toast.success as jest.Mock).mock.calls[0][1].action;
    act(() => action.onClick());

    // Restored in the middle, not appended at the end.
    await waitFor(() => {
      expect(titlesInOrder()).toEqual(['r.example.org/01/first', 'r.example.org/01/middle', 'r.example.org/01/last']);
    });
  });

  it('tells the user when Undo has nothing to restore', async () => {
    render(
      <Harness
        initial={[{ payload: storedLinkSet({ kind: 'url', url: 'https://r.example.org/01/1?linkType=all' }) }]}
      />,
    );

    fireEvent.click(await screen.findByLabelText('Remove r.example.org/01/1'));
    await waitFor(() => {
      expect(screen.queryByTestId('linkset-card-header')).not.toBeInTheDocument();
    });

    // Restore once (succeeds), then fire the same Undo again: the slot is already back, so the
    // second click must say so rather than silently doing nothing.
    const action = (toast.success as jest.Mock).mock.calls[0][1].action;
    act(() => action.onClick());
    expect(await screen.findByTestId('linkset-card-header')).toBeInTheDocument();

    act(() => action.onClick());
    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('already back'));
    });
    expect(screen.getAllByTestId('linkset-card-header')).toHaveLength(1);
  });

  it('refreshes the linked-credential rows when the same identity is re-ingested with a new body', async () => {
    const source = { kind: 'url', url: 'https://r.example.org/01/1?linkType=all' } as const;
    const updated: StoredLinkSet = {
      original: { linkset: [] },
      decoded: {
        linkset: [
          {
            anchor: 'https://id.example.org/01/1',
            dpp: [{ href: 'https://x.example.org/creds/new-only.json', type: 'application/vc+ld+json' }],
          },
        ],
      },
      source,
    };

    render(<Harness initial={[{ payload: storedLinkSet(source) }]} reingest={updated} />);

    fireEvent.click(await screen.findByTestId('linkset-card-header'));
    expect(screen.getAllByTestId('linked-credential-row')).toHaveLength(2);

    fireEvent.click(screen.getByTestId('harness-reingest'));

    // The replaced slot keeps its instanceId, so the card stays mounted and expanded; the rows
    // must now come from the new body only.
    await waitFor(() => {
      expect(screen.getAllByTestId('linked-credential-row')).toHaveLength(1);
    });
    expect(screen.getByText('https://x.example.org/creds/new-only.json')).toBeInTheDocument();
  });
});
