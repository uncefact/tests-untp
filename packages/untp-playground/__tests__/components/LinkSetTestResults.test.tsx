import { LinkSetTestResults } from '@/components/LinkSetTestResults';
import { useArtefactCollection } from '@/hooks/useArtefactCollection';
import { upsert } from '@/lib/artefactCollection';
import { linkSetKey } from '@/lib/linkSetCollection';
import { newId } from '@/lib/id';
import type { StoredLinkSet, TestStep } from '@/types';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { toast } from 'sonner';
import { useEffect } from 'react';

jest.mock('@/lib/fetchLinkedCredential', () => ({
  fetchLinkedCredential: jest.fn(),
}));

// eslint-disable-next-line import/first
import { fetchLinkedCredential } from '@/lib/fetchLinkedCredential';

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
        { href: 'https://x.example.org/creds/dcc.json', type: 'application/vc+jwt', encryptionMethod: 'AES-128' },
      ],
      pip: [{ href: 'https://products.example.org/1', type: 'text/html', title: 'Product page' }],
    },
  ],
};

const mockOnVerifyCredential = jest.fn();

function Harness({
  initial,
  reingest,
  credentialItems = [],
  urlBindings = new Map(),
}: {
  initial: Array<{ payload: StoredLinkSet }>;
  reingest?: StoredLinkSet;
  credentialItems?: any[];
  urlBindings?: Map<string, string>;
}) {
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
      <LinkSetTestResults
        collection={linkSet.state}
        dispatch={linkSet.dispatch}
        credentialItems={credentialItems}
        urlBindings={urlBindings}
        onVerifyCredential={mockOnVerifyCredential}
      />
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

describe('linked-credential Verify (#812)', () => {
  const urlSource = { kind: 'url' as const, url: 'https://r.example.org/01/1?linkType=all' };
  const DPP_HREF = 'https://x.example.org/creds/dpp.json';
  const DCC_HREF = 'https://x.example.org/creds/dcc.json';
  const expandCard = () => fireEvent.click(screen.getByTestId('linkset-card-header'));
  const firstVerify = () => screen.getAllByTestId('linked-credential-verify')[0];

  const credentialInstance = (instanceId: string, statuses: string[], sourceUrl = DPP_HREF) => ({
    instanceId,
    runId: null,
    contentHash: `hash-${instanceId}`,
    payload: { original: {}, decoded: {}, source: { kind: 'url', url: sourceUrl, via: 'link-set' } },
    result: statuses.map((status, index) => ({ id: `step-${index}`, name: `Step ${index}`, status })),
  });

  beforeEach(() => {
    mockOnVerifyCredential.mockReturnValue({ accepted: true, instanceId: 'inst-new' });
  });

  it('renders a Verify button per credential row and fetches nothing on render', () => {
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    expect(screen.getAllByTestId('linked-credential-verify')).toHaveLength(2);
    expect(fetchLinkedCredential).not.toHaveBeenCalled();
  });

  it('shows the Encrypted tag only on a target declaring an encryptionMethod', () => {
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    expect(screen.getAllByTestId('linked-credential-encrypted')).toHaveLength(1);
    const rows = screen.getAllByTestId('linked-credential-row');
    const dccRow = rows.find((row) => row.textContent?.includes('creds/dcc.json')) as HTMLElement;
    const tag = within(dccRow).getByTestId('linked-credential-encrypted');
    // The tag sits in the label paragraph, before the row's action column.
    expect(
      tag.compareDocumentPosition(within(dccRow).getByTestId('linked-credential-verify')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('fetches on Verify and routes the credential into the pipeline with link-set provenance', async () => {
    (fetchLinkedCredential as jest.Mock).mockResolvedValue({
      ok: true,
      credential: { type: ['VerifiableCredential'] },
    });
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    fireEvent.click(firstVerify());

    await waitFor(() => {
      expect(mockOnVerifyCredential).toHaveBeenCalledWith(
        { type: ['VerifiableCredential'] },
        { kind: 'url', url: DPP_HREF, via: 'link-set' },
      );
    });
    expect(fetchLinkedCredential).toHaveBeenCalledWith(DPP_HREF);
    expect(toast.success).toHaveBeenCalledWith('Verifying Digital Product Passport in the Credentials tab');
  });

  it('shows a visible Fetching phase while the proxy request is in flight, then returns on failure', async () => {
    let release: (value: unknown) => void = () => {};
    (fetchLinkedCredential as jest.Mock).mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    fireEvent.click(firstVerify());
    expect(screen.getByTestId('linked-credential-fetching')).toHaveTextContent('Fetching...');
    // The clicked row's button is gone while fetching; the other row keeps its own.
    expect(screen.getAllByTestId('linked-credential-verify')).toHaveLength(1);

    await act(async () => {
      release({ ok: false, message: 'nope' });
    });
    expect(screen.queryByTestId('linked-credential-fetching')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('linked-credential-verify')).toHaveLength(2);
  });

  it('keeps the Fetching phase across a collapse and re-expand, preventing a double fetch', async () => {
    let release: (value: unknown) => void = () => {};
    (fetchLinkedCredential as jest.Mock).mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();
    fireEvent.click(firstVerify());

    expandCard(); // collapse (rows unmount)
    expandCard(); // re-expand

    // The in-flight flag lives at the list level, so the re-mounted row still shows Fetching.
    expect(screen.getByTestId('linked-credential-fetching')).toBeInTheDocument();
    expect(fetchLinkedCredential).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ ok: false, message: 'nope' });
    });
  });

  it('reports a failed fetch and keeps the row verifiable', async () => {
    (fetchLinkedCredential as jest.Mock).mockResolvedValue({ ok: false, message: 'The URL was blocked.' });
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    fireEvent.click(firstVerify());

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('The URL was blocked.');
    });
    expect(mockOnVerifyCredential).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('linked-credential-verify')).toHaveLength(2);
  });

  it('reports a rejected document instead of announcing a verification that never began', async () => {
    (fetchLinkedCredential as jest.Mock).mockResolvedValue({ ok: true, credential: { not: 'a credential' } });
    mockOnVerifyCredential.mockReturnValue({ accepted: false });
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    fireEvent.click(firstVerify());

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'That link did not return an accepted credential. Open View Upload Detail for the reason.',
      );
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('catches a throwing ingestion, tells the user, and leaves the row verifiable again', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    (fetchLinkedCredential as jest.Mock).mockResolvedValue({ ok: true, credential: null });
    mockOnVerifyCredential.mockImplementation(() => {
      throw new TypeError('boom');
    });
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    fireEvent.click(firstVerify());

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Could not process that credential. Check the link and try again.');
    });
    expect(screen.getAllByTestId('linked-credential-verify')).toHaveLength(2);
  });

  it.each([
    [['pending', 'success'], 'linked-credential-verifying', 'Verifying in Credentials tab'],
    [['success', 'success'], 'linked-credential-verified', 'Verified'],
    [['failure', 'success'], 'linked-credential-failed', 'Failed in Credentials tab'],
  ])('derives the row state from its bound instance (%j)', (statuses, testId, text) => {
    render(
      <Harness
        initial={[{ payload: storedLinkSet(urlSource) }]}
        credentialItems={[credentialInstance('inst-1', statuses as string[])]}
        urlBindings={new Map([[DPP_HREF, 'inst-1']])}
      />,
    );
    expandCard();

    const rows = screen.getAllByTestId('linked-credential-row');
    const dppRow = rows.find((row) => row.textContent?.includes('creds/dpp.json')) as HTMLElement;
    expect(within(dppRow).getByTestId(testId)).toHaveTextContent(text);
    expect(within(dppRow).queryByTestId('linked-credential-verify')).not.toBeInTheDocument();
  });

  it('keeps the row bound when a mirror URL replaced the instance and rewrote its source', () => {
    // Same bytes fetched from another URL: content-hash upsert kept the instance id but replaced
    // the stored source with the other URL. The binding still names the id, so the row keeps its
    // note instead of reverting to Verify (the failure the panel review caught).
    render(
      <Harness
        initial={[{ payload: storedLinkSet(urlSource) }]}
        credentialItems={[credentialInstance('inst-1', ['success'], 'https://mirror.example.org/same-bytes.json')]}
        urlBindings={new Map([[DPP_HREF, 'inst-1']])}
      />,
    );
    expandCard();

    expect(screen.getByTestId('linked-credential-verified')).toHaveTextContent('Verified');
  });

  it('follows the binding to the newest instance after content drift at the same URL', () => {
    // The URL first produced inst-old (failed), then drifted content appended inst-new (running).
    // The binding records the latest ingestion, so the row reports inst-new, not the stale first
    // array match.
    render(
      <Harness
        initial={[{ payload: storedLinkSet(urlSource) }]}
        credentialItems={[credentialInstance('inst-old', ['failure']), credentialInstance('inst-new', ['pending'])]}
        urlBindings={new Map([[DPP_HREF, 'inst-new']])}
      />,
    );
    expandCard();

    expect(screen.getByTestId('linked-credential-verifying')).toHaveTextContent('Verifying in Credentials tab');
  });

  it('fails open to the Verify button when the bound instance was removed', () => {
    render(
      <Harness
        initial={[{ payload: storedLinkSet(urlSource) }]}
        credentialItems={[]}
        urlBindings={new Map([[DPP_HREF, 'inst-gone']])}
      />,
    );
    expandCard();

    expect(screen.getAllByTestId('linked-credential-verify')).toHaveLength(2);
  });

  it('offers Verify again on a settled row and re-fetches through it', async () => {
    (fetchLinkedCredential as jest.Mock).mockResolvedValue({
      ok: true,
      credential: { type: ['VerifiableCredential'] },
    });
    render(
      <Harness
        initial={[{ payload: storedLinkSet(urlSource) }]}
        credentialItems={[credentialInstance('inst-1', ['success'])]}
        urlBindings={new Map([[DPP_HREF, 'inst-1']])}
      />,
    );
    expandCard();

    fireEvent.click(screen.getByTestId('linked-credential-verify-again'));

    await waitFor(() => {
      expect(fetchLinkedCredential).toHaveBeenCalledWith(DPP_HREF);
    });
    expect(mockOnVerifyCredential).toHaveBeenCalled();
  });

  it('offers no Verify again while the bound instance is still running', () => {
    render(
      <Harness
        initial={[{ payload: storedLinkSet(urlSource) }]}
        credentialItems={[credentialInstance('inst-1', ['pending'])]}
        urlBindings={new Map([[DPP_HREF, 'inst-1']])}
      />,
    );
    expandCard();

    expect(screen.queryByTestId('linked-credential-verify-again')).not.toBeInTheDocument();
  });
});

describe('encrypted discovery fallback (#812)', () => {
  const urlSource = { kind: 'url' as const, url: 'https://r.example.org/01/1?linkType=all' };
  const expandCard = () => fireEvent.click(screen.getByTestId('linkset-card-header'));

  beforeEach(() => {
    mockOnVerifyCredential.mockReturnValue({ accepted: true, instanceId: 'inst-new' });
  });

  it('adds the Encrypted tag to an untagged row when ingestion classifies the body encrypted, and keeps it across collapse', async () => {
    (fetchLinkedCredential as jest.Mock).mockResolvedValue({
      ok: true,
      credential: {
        cipherText: 'SGVsbG8=',
        iv: 'nLUYsnXBY8bbXY45',
        tag: '7j0RRSoEIm2FAo52m1pyow==',
        type: 'aes-256-gcm',
      },
    });
    mockOnVerifyCredential.mockReturnValue({ accepted: false, encrypted: true });
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    // The dpp row carries no encryptionMethod metadata, so it starts untagged.
    const rows = screen.getAllByTestId('linked-credential-row');
    const dppRow = rows.find((row) => row.textContent?.includes('creds/dpp.json')) as HTMLElement;
    expect(within(dppRow).queryByTestId('linked-credential-encrypted')).not.toBeInTheDocument();

    fireEvent.click(within(dppRow).getByTestId('linked-credential-verify'));
    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        'This credential appears to be encrypted. Decryption arrives in a later release.',
      );
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('linked-credential-encrypted')).toHaveLength(2);

    // The discovery lives at the list level: collapse and re-expand keeps the tag.
    expandCard();
    expandCard();
    const rowsAfter = screen.getAllByTestId('linked-credential-row');
    const dppAfter = rowsAfter.find((row) => row.textContent?.includes('creds/dpp.json')) as HTMLElement;
    expect(within(dppAfter).getByTestId('linked-credential-encrypted')).toBeInTheDocument();
    // Still verifiable: the metadata was a discovery, not a lockout.
    expect(within(dppAfter).getByTestId('linked-credential-verify')).toBeInTheDocument();
  });

  it('clears the discovered tag when a later Verify is accepted as plaintext', async () => {
    // First fetch: encrypted discovery. Second fetch (target drifted to plaintext): accepted.
    (fetchLinkedCredential as jest.Mock).mockResolvedValueOnce({
      ok: true,
      credential: {
        cipherText: 'SGVsbG8=',
        iv: 'nLUYsnXBY8bbXY45',
        tag: '7j0RRSoEIm2FAo52m1pyow==',
        type: 'aes-256-gcm',
      },
    });
    mockOnVerifyCredential.mockReturnValueOnce({ accepted: false, encrypted: true });
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();
    const rows = screen.getAllByTestId('linked-credential-row');
    const dppRow = rows.find((row) => row.textContent?.includes('creds/dpp.json')) as HTMLElement;

    fireEvent.click(within(dppRow).getByTestId('linked-credential-verify'));
    await waitFor(() => {
      expect(within(dppRow).getByTestId('linked-credential-encrypted')).toBeInTheDocument();
    });

    (fetchLinkedCredential as jest.Mock).mockResolvedValueOnce({
      ok: true,
      credential: { type: ['VerifiableCredential'] },
    });
    mockOnVerifyCredential.mockReturnValueOnce({ accepted: true, instanceId: 'inst-new' });
    fireEvent.click(within(dppRow).getByTestId('linked-credential-verify'));

    await waitFor(() => {
      expect(within(dppRow).queryByTestId('linked-credential-encrypted')).not.toBeInTheDocument();
    });
  });

  it('keeps a plain fetch failure on the error toast without tagging the row', async () => {
    (fetchLinkedCredential as jest.Mock).mockResolvedValue({
      ok: false,
      message: 'The URL returned 404. Check the address.',
    });
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    const rows = screen.getAllByTestId('linked-credential-row');
    const dppRow = rows.find((row) => row.textContent?.includes('creds/dpp.json')) as HTMLElement;
    fireEvent.click(within(dppRow).getByTestId('linked-credential-verify'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('The URL returned 404. Check the address.');
    });
    expect(screen.getAllByTestId('linked-credential-encrypted')).toHaveLength(1);
  });
});
