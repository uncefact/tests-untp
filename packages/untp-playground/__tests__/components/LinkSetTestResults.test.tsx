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

// The schema fetch is replaced with a controllable promise: the transport and the real schema are
// covered in linkSetValidation.test.ts; here the card's lifecycle around the run is what matters.
jest.mock('@/lib/linkSetValidation', () => ({
  ...jest.requireActual('@/lib/linkSetValidation'),
  validateLinkSetSchema: jest.fn(),
}));
import { validateLinkSetSchema } from '@/lib/linkSetValidation';
const mockValidate = validateLinkSetSchema as jest.MockedFunction<typeof validateLinkSetSchema>;
const SCHEMA_URL = 'https://untp.unece.org/artefacts/schema/v0.7.0/idr/LinksetSchema.json';
const validDocument = () =>
  Promise.resolve({ kind: 'document' as const, valid: true, errors: [], version: '0.7.0', schemaUrl: SCHEMA_URL });

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
      idr: [
        {
          href: 'https://resolver.item.example.org/01/1/21/serial',
          type: 'application/linkset+json',
          title: 'Item-level resolver',
        },
      ],
    },
  ],
};

const mockOnVerifyCredential = jest.fn();
const mockOnResolveSecondary = jest.fn(async () => {});

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
        onResolveSecondary={mockOnResolveSecondary}
      />
    </>
  );
}

const storedLinkSet = (source: StoredLinkSet['source'], validationVersion = '0.7.0'): StoredLinkSet => ({
  original: LINK_SET,
  decoded: LINK_SET,
  source,
  validationVersion,
});

describe('LinkSetTestResults', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidate.mockImplementation(validDocument);
  });

  it('runs Schema Validation against the stored version and settles the card to success', async () => {
    render(
      <Harness
        initial={[{ payload: storedLinkSet({ kind: 'url', url: 'https://r.example.org/01/1?linkType=all' }) }]}
      />,
    );

    const header = await screen.findByTestId('linkset-card-header');
    const instanceId = header.getAttribute('data-instance-id') as string;
    // The card's own icon (keyed by instance id), not only the step's: AC1 is about the card.
    await screen.findByTestId(`${instanceId}-status-icon-success`);
    expect(mockValidate).toHaveBeenCalledWith(LINK_SET, '0.7.0');
    expect(screen.getByTestId('linkset-subtitle')).toHaveTextContent('Link Set · v0.7.0');

    fireEvent.click(header);
    expect(screen.getByText('Schema Validation')).toBeInTheDocument();
    expect(screen.queryByTestId('linkset-schema-errors')).not.toBeInTheDocument();
    expect(screen.getByTestId('linkset-validation-docs')).toHaveAttribute(
      'href',
      expect.stringContaining('validating-link-sets'),
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
    expect(screen.getByTestId('linkset-subtitle')).toHaveTextContent('Link Set · v0.7.0');

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
      validationVersion: '0.7.0',
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
      validationVersion: '0.7.0',
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
    payload: { original: {}, decoded: {}, source: { kind: 'url', url: sourceUrl, via: 'link-set' } }, // a credential slot, not a link set
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
    mockOnVerifyCredential.mockReturnValue({ accepted: true, instanceId: 'inst-enc', encrypted: true });
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    // The dpp row carries no encryptionMethod metadata, so it starts untagged.
    const rows = screen.getAllByTestId('linked-credential-row');
    const dppRow = rows.find((row) => row.textContent?.includes('creds/dpp.json')) as HTMLElement;
    expect(within(dppRow).queryByTestId('linked-credential-encrypted')).not.toBeInTheDocument();

    fireEvent.click(within(dppRow).getByTestId('linked-credential-verify'));
    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        'This credential is encrypted. Enter its key on the Credentials tab to decrypt and verify it.',
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
    mockOnVerifyCredential.mockReturnValueOnce({ accepted: true, instanceId: 'inst-enc', encrypted: true });
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

describe('secondary resolver rows (#974)', () => {
  const urlSource = { kind: 'url' as const, url: 'https://r.example.org/01/1?linkType=all' };
  const expandCard = () => fireEvent.click(screen.getByTestId('linkset-card-header'));

  beforeEach(() => {
    mockOnVerifyCredential.mockReturnValue({ accepted: true, instanceId: 'inst-new' });
  });

  it('lists the secondary resolver with a Resolve action, outside credential rows and the other-links count', () => {
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    const section = screen.getByTestId('secondary-resolvers');
    expect(section).toHaveTextContent('Secondary resolvers · 1');
    expect(within(section).getByTestId('secondary-resolver-resolve')).toBeInTheDocument();
    expect(section).toHaveTextContent('Item-level resolver');
    // Credential rows unchanged; the pip page stays the only other link.
    expect(screen.getAllByTestId('linked-credential-row')).toHaveLength(2);
    expect(screen.getByTestId('other-links-note')).toHaveTextContent('1 other link');
    expect(mockOnResolveSecondary).not.toHaveBeenCalled();
  });

  it('resolves the secondary link through the page flow on click, with a visible Resolving phase', async () => {
    let release: () => void = () => {};
    mockOnResolveSecondary.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    fireEvent.click(screen.getByTestId('secondary-resolver-resolve'));
    expect(screen.getByTestId('secondary-resolver-resolving')).toHaveTextContent('Resolving...');
    expect(mockOnResolveSecondary).toHaveBeenCalledWith('https://resolver.item.example.org/01/1/21/serial');

    await act(async () => {
      release();
    });
    expect(screen.getByTestId('secondary-resolver-resolve')).toBeInTheDocument();
  });

  it('reports a throwing resolve and returns the row to its Resolve action', async () => {
    jest.spyOn(console, 'error').mockImplementation();
    mockOnResolveSecondary.mockRejectedValueOnce(new Error('boom'));
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    expandCard();

    fireEvent.click(screen.getByTestId('secondary-resolver-resolve'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Could not resolve that link set. Check the link and try again.');
    });
    expect(screen.getByTestId('secondary-resolver-resolve')).toBeInTheDocument();
  });
});

describe('secondary resolver section rendering (#974 review findings)', () => {
  const urlSource = { kind: 'url' as const, url: 'https://r.example.org/01/1?linkType=all' };
  const expandCard = () => fireEvent.click(screen.getByTestId('linkset-card-header'));

  it('renders no Secondary resolvers section when the link set has none', () => {
    const withoutIdr = {
      linkset: [
        {
          anchor: 'https://id.example.org/01/1',
          'https://test.uncefact.org/voc/untp/dpp': [{ href: 'https://x.example.org/creds/dpp.json' }],
        },
      ],
    };
    render(
      <Harness
        initial={[
          { payload: { original: withoutIdr, decoded: withoutIdr, source: urlSource, validationVersion: '0.7.0' } },
        ]}
      />,
    );
    expandCard();

    expect(screen.queryByTestId('secondary-resolvers')).not.toBeInTheDocument();
  });

  it('renders two secondary resolvers as independent rows with their own Resolve actions', () => {
    const twoIdr = {
      linkset: [
        {
          anchor: 'https://id.example.org/01/1',
          idr: [
            { href: 'https://resolver-a.example.org/01/1', type: 'application/linkset+json', title: 'Resolver A' },
            { href: 'https://resolver-b.example.org/01/1', type: 'application/linkset+json', title: 'Resolver B' },
          ],
        },
      ],
    };
    render(
      <Harness
        initial={[{ payload: { original: twoIdr, decoded: twoIdr, source: urlSource, validationVersion: '0.7.0' } }]}
      />,
    );
    expandCard();

    expect(screen.getByTestId('secondary-resolvers')).toHaveTextContent('Secondary resolvers · 2');
    expect(screen.getAllByTestId('secondary-resolver-resolve')).toHaveLength(2);

    // Clicking one row's Resolve puts only that row into the Resolving phase.
    let release: () => void = () => {};
    mockOnResolveSecondary.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    fireEvent.click(screen.getAllByTestId('secondary-resolver-resolve')[0]);
    expect(screen.getAllByTestId('secondary-resolver-resolving')).toHaveLength(1);
    expect(screen.getAllByTestId('secondary-resolver-resolve')).toHaveLength(1);
    expect(mockOnResolveSecondary).toHaveBeenCalledWith('https://resolver-a.example.org/01/1');
    release();
  });
});

describe('secondary resolver panel rulings (#974 r2)', () => {
  const urlSource = { kind: 'url' as const, url: 'https://r.example.org/01/1?linkType=all' };
  const expandCard = () => fireEvent.click(screen.getByTestId('linkset-card-header'));

  it('gives repeated generic titles distinct accessible names via the href', () => {
    const twoSame = {
      linkset: [
        {
          idr: [
            {
              href: 'https://resolver-a.example.org/01/1',
              type: 'application/linkset+json',
              title: 'Secondary Identity Resolver',
            },
            {
              href: 'https://resolver-b.example.org/01/1',
              type: 'application/linkset+json',
              title: 'Secondary Identity Resolver',
            },
          ],
        },
      ],
    };
    render(
      <Harness
        initial={[{ payload: { original: twoSame, decoded: twoSame, source: urlSource, validationVersion: '0.7.0' } }]}
      />,
    );
    expandCard();

    expect(
      screen.getByRole('button', { name: 'Resolve Secondary Identity Resolver (https://resolver-a.example.org/01/1)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Resolve Secondary Identity Resolver (https://resolver-b.example.org/01/1)' }),
    ).toBeInTheDocument();
  });

  it('does not cross-lock a Verify and a Resolve that share an href', async () => {
    const sharedHref = 'https://shared.example.org/01/1';
    const doc = {
      linkset: [
        {
          'untp:dpp': [{ href: sharedHref, type: 'application/vc+ld+json' }],
          idr: [{ href: sharedHref, type: 'application/linkset+json', title: 'Same-href resolver' }],
        },
      ],
    };
    let releaseResolve: () => void = () => {};
    mockOnResolveSecondary.mockReturnValue(new Promise<void>((resolve) => (releaseResolve = resolve)));
    let releaseVerify: (value: unknown) => void = () => {};
    (fetchLinkedCredential as jest.Mock).mockReturnValue(new Promise((resolve) => (releaseVerify = resolve)));

    render(
      <Harness
        initial={[{ payload: { original: doc, decoded: doc, source: urlSource, validationVersion: '0.7.0' } }]}
      />,
    );
    expandCard();

    // Start the Resolve: only the secondary row goes busy; the credential row keeps Verify.
    fireEvent.click(screen.getByTestId('secondary-resolver-resolve'));
    expect(screen.getByTestId('secondary-resolver-resolving')).toBeInTheDocument();
    expect(screen.getByTestId('linked-credential-verify')).toBeEnabled();

    // Start the Verify too: both operations are in flight independently.
    fireEvent.click(screen.getByTestId('linked-credential-verify'));
    expect(screen.getByTestId('linked-credential-fetching')).toBeInTheDocument();
    expect(screen.getByTestId('secondary-resolver-resolving')).toBeInTheDocument();

    // Settling one leaves the other in flight.
    await act(async () => {
      releaseResolve();
    });
    expect(screen.getByTestId('secondary-resolver-resolve')).toBeInTheDocument();
    expect(screen.getByTestId('linked-credential-fetching')).toBeInTheDocument();
    await act(async () => {
      releaseVerify({ ok: false, message: 'done' });
    });
  });
});

describe('already-decrypted re-verify feedback (#813)', () => {
  it('toasts the honest already-decrypted message and clears any discovery, with no key prompt', async () => {
    const urlSource = { kind: 'url' as const, url: 'https://r.example.org/01/1?linkType=all' };
    (fetchLinkedCredential as jest.Mock).mockResolvedValue({
      ok: true,
      credential: {
        cipherText: 'SGVsbG8=',
        iv: 'nLUYsnXBY8bbXY45',
        tag: '7j0RRSoEIm2FAo52m1pyow==',
        type: 'aes-256-gcm',
      },
    });
    mockOnVerifyCredential.mockReturnValue({ accepted: true, instanceId: 'inst-dec', alreadyDecrypted: true });
    render(<Harness initial={[{ payload: storedLinkSet(urlSource) }]} />);
    fireEvent.click(screen.getByTestId('linkset-card-header'));

    fireEvent.click(screen.getAllByTestId('linked-credential-verify')[0]);

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        'This credential was already decrypted and verified on the Credentials tab.',
      );
    });
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('Schema Validation outcomes (#988)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const source = { kind: 'url', url: 'https://r.example.org/01/1?linkType=all' } as const;

  it('shows the spinner while the schema fetch is in flight, then the outcome', async () => {
    let release: (value: Awaited<ReturnType<typeof validateLinkSetSchema>>) => void = () => {};
    mockValidate.mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<Harness initial={[{ payload: storedLinkSet(source) }]} />);

    await screen.findByTestId('linkset-card-header');
    expect(screen.getAllByTestId(/status-icon-in-progress/).length).toBeGreaterThan(0);

    await act(async () => release(await validDocument()));
    await waitFor(() => expect(screen.getAllByTestId(/status-icon-success/).length).toBeGreaterThan(0));
    expect(screen.queryAllByTestId(/status-icon-in-progress/)).toHaveLength(0);
  });

  it('lists each offending path with the rule it broke, decoding URL relation keys', async () => {
    mockValidate.mockResolvedValue({
      kind: 'document',
      valid: false,
      version: '0.7.0',
      schemaUrl: SCHEMA_URL,
      errors: [
        { keyword: 'required', instancePath: '/linkset/0', params: { missingProperty: 'anchor' } },
        {
          keyword: 'required',
          instancePath: '/linkset/0/https:~1~1test.uncefact.org~1voc~1untp~1dpp/0',
          params: { missingProperty: 'title' },
        },
        { keyword: 'additionalProperties', instancePath: '/linkset/0/dpp/0', params: { additionalProperty: 'colour' } },
      ] as any,
    });
    render(<Harness initial={[{ payload: storedLinkSet(source) }]} />);

    const header = await screen.findByTestId('linkset-card-header');
    const instanceId = header.getAttribute('data-instance-id') as string;
    await screen.findByTestId(`${instanceId}-status-icon-failure`);
    fireEvent.click(header);
    const items = within(screen.getByTestId('linkset-schema-errors')).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Missing required field: linkset → 0 → anchor',
      'Missing required field: linkset → 0 → https://test.uncefact.org/voc/untp/dpp → 0 → title',
      'Unknown field at linkset → 0 → dpp → 0: colour',
    ]);
  });

  it('explains a relation the published schema rejects instead of calling it an unknown field', async () => {
    const withCurie = {
      linkset: [{ anchor: 'https://id.example.org/01/1', 'untp:dpp': [{ href: 'https://x.example/a', title: 't' }] }],
    };
    mockValidate.mockResolvedValue({
      kind: 'document',
      valid: false,
      version: '0.7.0',
      schemaUrl: SCHEMA_URL,
      errors: [
        { keyword: 'additionalProperties', instancePath: '/linkset/0', params: { additionalProperty: 'untp:dpp' } },
      ] as any,
    });
    render(
      <Harness
        initial={[{ payload: { original: withCurie, decoded: withCurie, source, validationVersion: '0.7.0' } }]}
      />,
    );

    const header = await screen.findByTestId('linkset-card-header');
    await waitFor(() => expect(screen.getAllByTestId(/status-icon-failure/).length).toBeGreaterThan(0));
    fireEvent.click(header);
    const item = within(screen.getByTestId('linkset-schema-errors')).getByRole('listitem');
    expect(item).toHaveAttribute('data-relation-rule', 'true');
    // The plain path-and-rule line stays; the explanation follows it.
    expect(item).toHaveTextContent(
      'Unknown field at linkset → 0: untp:dpp. The published UNTP v0.7.0 schema rejects the relation "untp:dpp"',
    );
    expect(item).toHaveTextContent('not starting with "anchor", "description" or "itemDescription"');
    expect(item).toHaveTextContent('known restriction of the published schema');
    expect(item).toHaveTextContent('concerns the relation name only');
    expect(item).not.toHaveTextContent('not a problem with the credential');
    // The failure card still offers the docs link and Verify on its credential rows.
    expect(screen.getByTestId('linkset-validation-docs')).toHaveAttribute(
      'href',
      expect.stringContaining('validating-link-sets'),
    );
    expect(screen.getAllByTestId('linked-credential-verify').length).toBeGreaterThan(0);
  });

  it('keeps the plain unknown-field sentence for a context member that is not relation-shaped', async () => {
    const withScalar = {
      linkset: [
        {
          anchor: 'https://id.example.org/01/1',
          lastUpdated: '2026-01-01',
          dpp: [{ href: 'https://x.example/a', title: 't' }],
        },
      ],
    };
    mockValidate.mockResolvedValue({
      kind: 'document',
      valid: false,
      version: '0.7.0',
      schemaUrl: SCHEMA_URL,
      errors: [
        { keyword: 'additionalProperties', instancePath: '/linkset/0', params: { additionalProperty: 'lastUpdated' } },
      ] as any,
    });
    render(
      <Harness
        initial={[{ payload: { original: withScalar, decoded: withScalar, source, validationVersion: '0.7.0' } }]}
      />,
    );
    const header = await screen.findByTestId('linkset-card-header');
    await waitFor(() => expect(screen.getAllByTestId(/status-icon-failure/).length).toBeGreaterThan(0));
    fireEvent.click(header);
    const item = within(screen.getByTestId('linkset-schema-errors')).getByRole('listitem');
    expect(item).not.toHaveAttribute('data-relation-rule');
    expect(item).toHaveTextContent('Unknown field at linkset → 0: lastUpdated');
    expect(item).not.toHaveTextContent('rejects the relation');
  });

  it.each([
    ['not-found', 'No schema published at https://untp.unece.org/x (status 403).'],
    ['parse', 'Schema at https://untp.unece.org/x is not valid JSON.'],
  ] as const)('names the attempt without promising a retry when the service answered %s', async (reason, message) => {
    mockValidate.mockResolvedValue({
      kind: 'schema-unavailable',
      reason,
      message,
      version: '0.7.0',
      schemaUrl: SCHEMA_URL,
    });
    render(<Harness initial={[{ payload: storedLinkSet(source) }]} />);
    const header = await screen.findByTestId('linkset-card-header');
    await waitFor(() => expect(screen.getAllByTestId(/status-icon-failure/).length).toBeGreaterThan(0));
    fireEvent.click(header);
    const text = screen.getByTestId('linkset-schema-errors').textContent ?? '';
    expect(text).toContain('The link set schema for UNTP v0.7.0 could not be loaded');
    expect(text).toContain('If this keeps happening, report it to the Playground operator');
    expect(text).toContain(`Details: ${message.replace(/\.$/, '')}.`);
    expect(text).toContain(SCHEMA_URL);
    expect(text).not.toContain('again to retry');
  });

  it('shows the loader message on an unusable schema so the operator has something to act on', async () => {
    mockValidate.mockResolvedValue({
      kind: 'schema-unusable',
      message: 'schema is invalid: data/type must be equal to one of the allowed values',
      version: '0.7.0',
      schemaUrl: SCHEMA_URL,
    });
    render(<Harness initial={[{ payload: storedLinkSet(source) }]} />);
    const header = await screen.findByTestId('linkset-card-header');
    await waitFor(() => expect(screen.getAllByTestId(/status-icon-failure/).length).toBeGreaterThan(0));
    fireEvent.click(header);
    expect(screen.getByTestId('linkset-schema-errors')).toHaveTextContent(
      'The schema loader reported: schema is invalid: data/type must be equal to one of the allowed values.',
    );
  });

  it("lets a replacement mid-run win: the old run's late result is rejected", async () => {
    let releaseFirst: (value: Awaited<ReturnType<typeof validateLinkSetSchema>>) => void = () => {};
    mockValidate.mockReturnValueOnce(new Promise((resolve) => (releaseFirst = resolve)));
    mockValidate.mockImplementation(() =>
      Promise.resolve({
        kind: 'document' as const,
        valid: false,
        errors: [{ keyword: 'required', instancePath: '/linkset/0', params: { missingProperty: 'anchor' } }] as any,
        version: '0.7.0',
        schemaUrl: SCHEMA_URL,
      }),
    );
    const replacement: StoredLinkSet = {
      original: { linkset: [] },
      decoded: { linkset: [] },
      source,
      validationVersion: '0.7.0',
    };
    render(<Harness initial={[{ payload: storedLinkSet(source) }]} reingest={replacement} />);
    await screen.findByTestId('linkset-card-header');
    expect(screen.getAllByTestId(/status-icon-in-progress/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('harness-reingest'));
    await waitFor(() => expect(mockValidate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByTestId(/status-icon-failure/).length).toBeGreaterThan(0));

    await act(async () => releaseFirst(await validDocument()));
    expect(screen.queryAllByTestId(/status-icon-success/)).toHaveLength(0);
    expect(screen.getAllByTestId(/status-icon-failure/).length).toBeGreaterThan(0);
  });

  it('fails with the could-not-be-loaded copy when the schema is unavailable, and stays removable', async () => {
    mockValidate.mockResolvedValue({
      kind: 'schema-unavailable',
      reason: 'network',
      message: 'Schema host unreachable (https://untp.unece.org/...).',
      version: '0.7.0',
      schemaUrl: SCHEMA_URL,
    });
    render(<Harness initial={[{ payload: storedLinkSet(source) }]} />);

    const header = await screen.findByTestId('linkset-card-header');
    await waitFor(() => expect(screen.getAllByTestId(/status-icon-failure/).length).toBeGreaterThan(0));
    fireEvent.click(header);
    expect(screen.getByTestId('linkset-schema-errors')).toHaveTextContent(
      'The link set schema for UNTP v0.7.0 could not be loaded, so this check could not determine whether the link set conforms. Details: Schema host unreachable (https://untp.unece.org/...). Resolve or upload the link set again to retry.',
    );
    expect(screen.getByLabelText('Remove r.example.org/01/1')).toBeEnabled();
  });

  it('names an unusable schema as an operator problem, without retry advice', async () => {
    mockValidate.mockResolvedValue({
      kind: 'schema-unusable',
      message: 'schema is invalid',
      version: '0.7.0',
      schemaUrl: SCHEMA_URL,
    });
    render(<Harness initial={[{ payload: storedLinkSet(source) }]} />);

    const header = await screen.findByTestId('linkset-card-header');
    await waitFor(() => expect(screen.getAllByTestId(/status-icon-failure/).length).toBeGreaterThan(0));
    fireEvent.click(header);
    const text = screen.getByTestId('linkset-schema-errors').textContent ?? '';
    expect(text).toContain('could not be used');
    expect(text).toContain('Report this problem to the Playground operator');
    expect(text).toContain(SCHEMA_URL);
    expect(text).not.toContain('again to retry');
  });

  it('settles the step as a failure when validation throws, never leaving the card spinning', async () => {
    mockValidate.mockRejectedValue(new Error('boom'));
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<Harness initial={[{ payload: storedLinkSet(source) }]} />);
      await screen.findByTestId('linkset-card-header');
      await waitFor(() => expect(screen.getAllByTestId(/status-icon-failure/).length).toBeGreaterThan(0));
      expect(screen.queryAllByTestId(/status-icon-in-progress/)).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('subtitles the card with the stored version, not a default', async () => {
    render(<Harness initial={[{ payload: storedLinkSet(source, '0.8.0') }]} />);
    await screen.findByTestId('linkset-card-header');
    expect(screen.getByTestId('linkset-subtitle')).toHaveTextContent('Link Set · v0.8.0');
    await waitFor(() => expect(mockValidate).toHaveBeenCalledWith(LINK_SET, '0.8.0'));
  });
});

describe('Undo during an unfinished run (#988, ADR-047 update)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidate.mockImplementation(validDocument);
  });

  const source = { kind: 'url', url: 'https://r.example.org/01/1?linkType=all' } as const;

  it('restarts validation when the original run finished while the card was removed', async () => {
    let releaseFirst: (value: Awaited<ReturnType<typeof validateLinkSetSchema>>) => void = () => {};
    mockValidate.mockReturnValueOnce(new Promise((resolve) => (releaseFirst = resolve)));
    mockValidate.mockImplementation(validDocument);
    render(<Harness initial={[{ payload: storedLinkSet(source) }]} />);

    await screen.findByTestId('linkset-card-header');
    expect(mockValidate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Remove r.example.org/01/1'));
    await waitFor(() => expect(screen.queryByTestId('linkset-card-header')).not.toBeInTheDocument());

    // The original run completes while the slot is gone: its commit is rejected by the run guard.
    await act(async () => releaseFirst(await validDocument()));

    const action = (toast.success as jest.Mock).mock.calls[0][1].action;
    act(() => action.onClick());
    await screen.findByTestId('linkset-card-header');

    // A fresh run, not the abandoned one, settles the restored card.
    await waitFor(() => expect(mockValidate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByTestId(/status-icon-success/).length).toBeGreaterThan(0));
    expect(screen.queryAllByTestId(/status-icon-in-progress/)).toHaveLength(0);
  });

  it('lets the new run own the slot when Undo happens before the original run finishes', async () => {
    let releaseFirst: (value: Awaited<ReturnType<typeof validateLinkSetSchema>>) => void = () => {};
    mockValidate.mockReturnValueOnce(new Promise((resolve) => (releaseFirst = resolve)));
    mockValidate.mockImplementation(() =>
      Promise.resolve({
        kind: 'document' as const,
        valid: false,
        errors: [{ keyword: 'required', instancePath: '/linkset/0', params: { missingProperty: 'anchor' } }] as any,
        version: '0.7.0',
        schemaUrl: SCHEMA_URL,
      }),
    );
    render(<Harness initial={[{ payload: storedLinkSet(source) }]} />);
    await screen.findByTestId('linkset-card-header');

    fireEvent.click(screen.getByLabelText('Remove r.example.org/01/1'));
    await waitFor(() => expect(screen.queryByTestId('linkset-card-header')).not.toBeInTheDocument());
    const action = (toast.success as jest.Mock).mock.calls[0][1].action;
    act(() => action.onClick());
    await screen.findByTestId('linkset-card-header');
    await waitFor(() => expect(mockValidate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByTestId(/status-icon-failure/).length).toBeGreaterThan(0));

    // The abandoned first run reports success late; it must not overwrite the new run's result.
    await act(async () => releaseFirst(await validDocument()));
    expect(screen.getAllByTestId(/status-icon-failure/).length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId(/status-icon-success/)).toHaveLength(0);
  });

  it('restores a settled result intact without re-running', async () => {
    render(<Harness initial={[{ payload: storedLinkSet(source) }]} />);
    await screen.findByTestId('linkset-card-header');
    await waitFor(() => expect(screen.getAllByTestId(/status-icon-success/).length).toBeGreaterThan(0));

    fireEvent.click(screen.getByLabelText('Remove r.example.org/01/1'));
    await waitFor(() => expect(screen.queryByTestId('linkset-card-header')).not.toBeInTheDocument());
    const action = (toast.success as jest.Mock).mock.calls[0][1].action;
    act(() => action.onClick());
    await screen.findByTestId('linkset-card-header');
    expect(screen.getAllByTestId(/status-icon-success/).length).toBeGreaterThan(0);
    expect(mockValidate).toHaveBeenCalledTimes(1);
  });
});
