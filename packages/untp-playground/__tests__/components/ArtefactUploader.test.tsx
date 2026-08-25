import '@testing-library/jest-dom';
import React, { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ArtefactUploader, type UploaderFamilyConfig } from '@/components/ArtefactUploader';
import { UPLOADER_FAMILIES } from '@/lib/uploaderFamilies';
import { toast } from 'sonner';

jest.mock('@/lib/resolveLinkSet', () => ({
  resolveLinkSet: jest.fn(),
}));

// eslint-disable-next-line import/first
import { resolveLinkSet } from '@/lib/resolveLinkSet';

// The production per-tab table (#676): rendering is asserted against the real configs, not
// duplicated literals, so drift in the shipped copy fails here.
const credentialsFamily: UploaderFamilyConfig = UPLOADER_FAMILIES.credentials;
const linkSetsFamily: UploaderFamilyConfig = UPLOADER_FAMILIES.linksets;

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

const mockResetData = jest.fn();

jest.mock('@/contexts/ErrorContext', () => ({
  useError: jest.fn(() => ({
    resetErrors: mockResetData,
  })),
}));

describe('ArtefactUploader component', () => {
  const mockOnArtefactUpload = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders the active family's copy on every slot of the uploader (#676)", () => {
    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    expect(screen.getByTestId('uploader-heading')).toHaveTextContent('Add a credential');
    expect(screen.getByText(/drag and drop, or click to select/i)).toBeInTheDocument();
    expect(screen.getByTestId('uploader-dropzone-subtitle')).toHaveTextContent('Verifiable Credential (JSON / JWT)');
    expect(screen.getByTestId('uploader-divider')).toHaveTextContent('or paste a URL');
    expect(screen.getByTestId('artefact-url-input')).toHaveAttribute(
      'placeholder',
      'https://example.org/credential.json',
    );
    expect(screen.getByTestId('artefact-url-fetch')).toHaveTextContent('Fetch');
    expect(screen.getByTestId('uploader-helper')).toHaveTextContent('Validated as a verifiable credential');
  });

  it('renders the Link Sets family with the Resolve verb and resolver copy', () => {
    render(
      <ArtefactUploader family={linkSetsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    expect(screen.getByTestId('uploader-heading')).toHaveTextContent('Add a link set');
    expect(screen.getByTestId('uploader-dropzone-subtitle')).toHaveTextContent('Link Set (JSON)');
    expect(screen.getByTestId('uploader-divider')).toHaveTextContent('or resolve from an identity resolver');
    expect(screen.getByTestId('artefact-url-fetch')).toHaveTextContent('Resolve');
  });

  it('routes the URL row through the link set resolver in resolve mode, keyed by the request URL', async () => {
    (resolveLinkSet as jest.Mock).mockResolvedValue({
      ok: true,
      payload: { linkset: [] },
      requestUrl: 'https://r.example.org/01/1?linkType=all',
      finalUrl: 'https://cdn.example.org/tokens/abc/linkset.json',
    });
    render(
      <ArtefactUploader family={linkSetsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );

    fireEvent.change(screen.getByTestId('artefact-url-input'), { target: { value: 'https://r.example.org/01/1' } });
    fireEvent.click(screen.getByTestId('artefact-url-fetch'));

    await waitFor(() => {
      expect(mockOnArtefactUpload).toHaveBeenCalledWith(
        { linkset: [] },
        { kind: 'url', url: 'https://r.example.org/01/1?linkType=all' },
      );
    });
    expect(resolveLinkSet).toHaveBeenCalledWith('https://r.example.org/01/1');
  });

  it('shows the resolver failure inline in resolve mode without uploading', async () => {
    (resolveLinkSet as jest.Mock).mockResolvedValue({
      ok: false,
      error: 'not-a-link-set',
      message: 'The resolver responded, but not with a link set (no RFC 9264 "linkset" array).',
    });
    render(
      <ArtefactUploader family={linkSetsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );

    fireEvent.change(screen.getByTestId('artefact-url-input'), { target: { value: 'https://r.example.org/x' } });
    fireEvent.click(screen.getByTestId('artefact-url-fetch'));

    expect(await screen.findByTestId('artefact-url-error')).toHaveTextContent('not with a link set');
    expect(mockOnArtefactUpload).not.toHaveBeenCalled();
  });

  it('asks for a URL first when the user submits the resolve-mode row empty', async () => {
    render(
      <ArtefactUploader family={linkSetsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );

    // The button stays enabled on an empty input precisely so this click can reach the message.
    const button = screen.getByTestId('artefact-url-fetch');
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(await screen.findByTestId('artefact-url-error')).toHaveTextContent('Enter a URL first.');
    expect(resolveLinkSet).not.toHaveBeenCalled();
    expect(mockOnArtefactUpload).not.toHaveBeenCalled();
  });

  it('renders every slot of every family from the production table', () => {
    for (const family of Object.values(UPLOADER_FAMILIES)) {
      const { unmount } = render(
        <ArtefactUploader family={family} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
      );
      expect(screen.getByTestId('uploader-heading')).toHaveTextContent(family.heading);
      expect(screen.getByTestId('uploader-dropzone-subtitle')).toHaveTextContent(family.dropzoneSubtitle);
      expect(screen.getByTestId('uploader-divider')).toHaveTextContent(family.divider);
      expect(screen.getByTestId('artefact-url-input')).toHaveAttribute('placeholder', family.urlPlaceholder);
      expect(screen.getByTestId('artefact-url-fetch')).toHaveTextContent(family.urlAction);
      expect(screen.getByTestId('uploader-helper')).toHaveTextContent(family.helper);
      unmount();
    }
  });

  it('routes a fetch-mode family through the generic document fetch, never the resolver', async () => {
    const schemesFamily: UploaderFamilyConfig = { ...credentialsFamily, heading: 'Add a conformity scheme' };
    const returnValue = { type: ['ConformityScheme'] };
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        body: JSON.stringify(returnValue),
        contentType: 'application/ld+json',
        finalUrl: 'https://example.org/scheme.jsonld',
      }),
    });

    render(<ArtefactUploader family={schemesFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />);
    fireEvent.change(screen.getByTestId('artefact-url-input'), {
      target: { value: 'https://example.org/scheme.jsonld' },
    });
    fireEvent.click(screen.getByTestId('artefact-url-fetch'));

    await waitFor(() => {
      expect(mockOnArtefactUpload).toHaveBeenCalledWith(returnValue, {
        kind: 'url',
        url: 'https://example.org/scheme.jsonld',
        requestedUrl: 'https://example.org/scheme.jsonld',
      });
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(resolveLinkSet).not.toHaveBeenCalled();
  });

  it('calls onArtefactUpload with the parsed JSON and a file source', async () => {
    const returnValue = { key: 'value' };
    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');

    const validJsonFile = new File([JSON.stringify(returnValue)], 'valid.json', {
      type: 'application/json',
    });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [validJsonFile] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockOnArtefactUpload).toHaveBeenCalledWith(returnValue, { kind: 'file', filename: 'valid.json' });
    });
  });

  it('accepts .jsonld files as JSON', async () => {
    const returnValue = { '@context': 'https://example.org/ctx', type: ['ConformityScheme'] };
    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');

    const schemeFile = new File([JSON.stringify(returnValue)], 'scheme.jsonld', {
      type: 'application/ld+json',
    });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [schemeFile] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockOnArtefactUpload).toHaveBeenCalledWith(returnValue, { kind: 'file', filename: 'scheme.jsonld' });
    });
  });

  it('displays an error for invalid file types', async () => {
    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');
    const invalidFile = new File(['content'], 'invalid.pdf', { type: 'application/pdf' });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [invalidFile] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Invalid file format. Please upload only .json, .jsonld, .jwt, or .txt files.',
    );
  });

  it('fetches a URL and calls onArtefactUpload with a url source', async () => {
    const returnValue = { type: ['ConformityScheme'] };
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        body: JSON.stringify(returnValue),
        contentType: 'application/ld+json',
        finalUrl: 'https://example.org/scheme.jsonld',
      }),
    });

    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    const urlInput = screen.getByTestId('artefact-url-input') as HTMLInputElement;
    const fetchButton = screen.getByTestId('artefact-url-fetch');

    await act(async () => {
      fireEvent.change(urlInput, { target: { value: 'https://example.org/scheme.jsonld' } });
    });
    await act(async () => {
      fireEvent.click(fetchButton);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockOnArtefactUpload).toHaveBeenCalledWith(returnValue, {
        kind: 'url',
        url: 'https://example.org/scheme.jsonld',
        requestedUrl: 'https://example.org/scheme.jsonld',
      });
    });
  });

  it('shows an inline error when the proxy reports the URL is blocked', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: 'blocked', message: 'private host' }),
    });

    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    const urlInput = screen.getByTestId('artefact-url-input') as HTMLInputElement;
    const fetchButton = screen.getByTestId('artefact-url-fetch');

    await act(async () => {
      fireEvent.change(urlInput, { target: { value: 'https://localhost/x' } });
    });
    await act(async () => {
      fireEvent.click(fetchButton);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(screen.getByTestId('artefact-url-error')).toHaveTextContent(/blocked/i);
    });
    expect(mockOnArtefactUpload).not.toHaveBeenCalled();
  });

  it('hands a .jwt file containing a compact JWE to ingestion raw, instead of a JWT decode error', async () => {
    const b64u = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwe = `${b64u('{"alg":"ECDH-ES","enc":"A256GCM"}')}..${b64u('iv')}.${b64u('ct')}.`;
    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');
    const jweFile = new File([jwe], 'encrypted.jwt', { type: 'text/plain' });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [jweFile] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockOnArtefactUpload).toHaveBeenCalledWith(jwe, { kind: 'file', filename: 'encrypted.jwt' });
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('points an HTML response at the Link Sets tab (a resolver redirected to its viewing page)', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        body: '<html>verify page</html>',
        contentType: 'text/html; charset=utf-8',
        finalUrl: 'https://verify.example.org/?q=x',
      }),
    });

    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    fireEvent.change(screen.getByTestId('artefact-url-input'), {
      target: { value: 'https://resolver.example.org/01/1' },
    });
    fireEvent.click(screen.getByTestId('artefact-url-fetch'));

    expect(await screen.findByTestId('artefact-url-error')).toHaveTextContent(
      'The URL returned a web page, not a JSON document. If this is an identity resolver link, resolve it on the Link Sets tab.',
    );
    expect(mockOnArtefactUpload).not.toHaveBeenCalled();
  });

  it('keeps the plain not-JSON message for a non-HTML body', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        body: 'plain text',
        contentType: 'text/plain',
        finalUrl: 'https://x.example.org/f.txt',
      }),
    });

    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    fireEvent.change(screen.getByTestId('artefact-url-input'), { target: { value: 'https://x.example.org/f.txt' } });
    fireEvent.click(screen.getByTestId('artefact-url-fetch'));

    expect(await screen.findByTestId('artefact-url-error')).toHaveTextContent(
      'The URL returned content that is not valid JSON.',
    );
  });

  it('forwards a compact JWE fetched by URL to ingestion instead of a not-JSON error', async () => {
    const b64u = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwe = `${b64u('{"alg":"ECDH-ES","enc":"A256GCM"}')}..${b64u('iv')}.${b64u('ct')}.`;
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        body: jwe,
        contentType: 'application/jose',
        finalUrl: 'https://x.example.org/c.jwt',
      }),
    });

    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    fireEvent.change(screen.getByTestId('artefact-url-input'), { target: { value: 'https://x.example.org/c.jwt' } });
    fireEvent.click(screen.getByTestId('artefact-url-fetch'));

    await waitFor(() => {
      expect(mockOnArtefactUpload).toHaveBeenCalledWith(jwe, {
        kind: 'url',
        url: 'https://x.example.org/c.jwt',
        requestedUrl: 'https://x.example.org/c.jwt',
      });
    });
    expect(screen.queryByTestId('artefact-url-error')).not.toBeInTheDocument();
  });

  it('does not call a text/htmlfoo response a web page', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, body: 'x', contentType: 'text/htmlfoo', finalUrl: 'https://x.example.org/f' }),
    });

    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    fireEvent.change(screen.getByTestId('artefact-url-input'), { target: { value: 'https://x.example.org/f' } });
    fireEvent.click(screen.getByTestId('artefact-url-fetch'));

    expect(await screen.findByTestId('artefact-url-error')).toHaveTextContent(
      'The URL returned content that is not valid JSON.',
    );
  });

  it('treats application/xhtml+xml as a web page', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        body: '<html/>',
        contentType: 'application/xhtml+xml',
        finalUrl: 'https://x.example.org/p',
      }),
    });

    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    fireEvent.change(screen.getByTestId('artefact-url-input'), { target: { value: 'https://x.example.org/p' } });
    fireEvent.click(screen.getByTestId('artefact-url-fetch'));

    expect(await screen.findByTestId('artefact-url-error')).toHaveTextContent('The URL returned a web page');
  });

  it('routes an uppercase .JWT file through the JOSE branch', async () => {
    const b64u = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const jwt = `${b64u('{"alg":"none"}')}.${b64u('{"vc":3}')}.`;
    render(
      <ArtefactUploader family={credentialsFamily} onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />,
    );
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');
    const file = new File([jwt], 'CREDENTIAL.JWT', { type: 'text/plain' });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [file] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockOnArtefactUpload).toHaveBeenCalledWith({ vc: 3 }, { kind: 'file', filename: 'CREDENTIAL.JWT' });
    });
  });
});
