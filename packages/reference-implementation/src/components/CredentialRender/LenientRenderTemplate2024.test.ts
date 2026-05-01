// Mirrors the mock in CredentialRender.test.tsx so the shim's super class
// is a deterministic stub: super.extractData returns {} and super.renderCredential
// records the args it was passed. Tests assert the shim's overrides on top.
jest.mock('@uncefact/vckit-renderer', () => ({
  Renderer: class {},
  WebRenderingTemplate2022: class {},
  RenderTemplate2024: class {
    extractData() {
      return {} as { template?: string; url?: string; mediaType?: string; mediaQuery?: string };
    }
    async renderCredential(args: { context?: { agent?: { computeHash?: unknown } } }) {
      return { _superCalledWith: args };
    }
  },
}));

import {
  LenientRenderTemplate2024,
  findValue,
  TEMPLATE_IRI_ALIASES,
  URL_IRI_ALIASES,
  MEDIA_TYPE_IRI_ALIASES,
  MEDIA_QUERY_IRI_ALIASES,
} from './CredentialRender';
import { computeDigestMultibase } from '../../utils';

const wrap = (value: string) => [{ '@value': value }];

describe('findValue', () => {
  it('returns the value at the first matching IRI', () => {
    const data = {
      'https://example.com/a': wrap('first'),
      'https://example.com/b': wrap('second'),
    };
    expect(findValue(data, ['https://example.com/a', 'https://example.com/b'])).toBe('first');
  });

  it('walks past missing IRIs to the first present one', () => {
    const data = { 'https://example.com/b': wrap('second') };
    expect(findValue(data, ['https://example.com/a', 'https://example.com/b'])).toBe('second');
  });

  it('returns undefined when no IRI matches', () => {
    expect(findValue({}, ['https://example.com/a'])).toBeUndefined();
  });
});

describe('LenientRenderTemplate2024.extractData', () => {
  const subject = new LenientRenderTemplate2024();

  it('falls through to the UNTP vocabulary IRI when parent omits template', () => {
    const data = { 'https://vocabulary.uncefact.org/untp/template': wrap('<h1>hi</h1>') };
    expect(subject.extractData(data).template).toBe('<h1>hi</h1>');
  });

  it('falls through to the UNTP vocabulary IRI when parent omits url', () => {
    const data = { 'https://vocabulary.uncefact.org/untp/url': wrap('https://cdn.example/t.html') };
    expect(subject.extractData(data).url).toBe('https://cdn.example/t.html');
  });

  it('falls through to the UNTP mediaQuery alias', () => {
    const data = { 'https://vocabulary.uncefact.org/untp/mediaQuery': wrap('@media print {}') };
    expect(subject.extractData(data).mediaQuery).toBe('@media print {}');
  });

  it('reads mediaType from the W3C issuer-dependent alias', () => {
    const data = {
      'https://www.w3.org/ns/credentials/issuer-dependent#mediaType': wrap('image/svg+xml'),
    };
    expect(subject.extractData(data).mediaType).toBe('image/svg+xml');
  });

  it('defaults mediaType to text/html when no IRI yields a value', () => {
    expect(subject.extractData({}).mediaType).toBe('text/html');
  });
});

describe('LenientRenderTemplate2024.renderCredential', () => {
  it('injects computeDigestMultibase as context.agent.computeHash', async () => {
    const subject = new LenientRenderTemplate2024();
    const result = (await subject.renderCredential({
      data: {},
      document: {},
    })) as unknown as { _superCalledWith: { context: { agent: { computeHash: unknown } } } };

    expect(result._superCalledWith.context.agent.computeHash).toBe(computeDigestMultibase);
  });

  it('preserves a pre-existing context.agent alongside computeHash', async () => {
    const subject = new LenientRenderTemplate2024();
    const signCredential = jest.fn();
    const result = (await subject.renderCredential({
      data: {},
      document: {},
      context: { agent: { signCredential } },
    })) as unknown as {
      _superCalledWith: { context: { agent: { computeHash: unknown; signCredential: unknown } } };
    };

    expect(result._superCalledWith.context.agent.signCredential).toBe(signCredential);
    expect(result._superCalledWith.context.agent.computeHash).toBe(computeDigestMultibase);
  });
});

describe('IRI alias constants', () => {
  it('include the published UNTP vocabulary namespace for template, url, and mediaQuery', () => {
    expect(TEMPLATE_IRI_ALIASES).toContain('https://vocabulary.uncefact.org/untp/template');
    expect(URL_IRI_ALIASES).toContain('https://vocabulary.uncefact.org/untp/url');
    expect(MEDIA_QUERY_IRI_ALIASES).toContain('https://vocabulary.uncefact.org/untp/mediaQuery');
  });

  it('include the schema.org encodingFormat IRI for mediaType', () => {
    expect(MEDIA_TYPE_IRI_ALIASES).toContain('https://schema.org/encodingFormat');
  });
});
