jest.mock('@/lib/api/logger');
const mockWarn = (jest.requireMock('@/lib/api/logger').appLogger as Record<string, jest.Mock>).warn;

import { readFileSync } from 'fs';
import { join } from 'path';
import { ValidationError } from '@/lib/api/validation';
import { sanitiseTemplate } from './sanitise-template';

/**
 * What would run if the HTML were inserted into a div, as the credential
 * renderer does, read from the jsdom test environment: elements carrying an
 * on* attribute, scripts, foreignObject, and links with a javascript: URL.
 */
function runnableInDiv(html: string): string[] {
  const div = document.createElement('div');
  div.innerHTML = html;
  return [...div.querySelectorAll('*')]
    .filter(
      (el) =>
        ['script', 'foreignobject'].includes(el.localName.toLowerCase()) ||
        [...el.attributes].some(
          (attribute) => attribute.name.toLowerCase().startsWith('on') || /^\s*javascript:/i.test(attribute.value),
        ),
    )
    .map((el) => el.localName.toLowerCase());
}

/** Sanitises the template and returns what would run in a div, or 'refused'. */
function runnableAfterSanitising(html: string): string[] | 'refused' {
  let output: string;
  try {
    output = sanitiseTemplate(html);
  } catch (error) {
    if (error instanceof ValidationError) return 'refused';
    throw error;
  }
  return runnableInDiv(output);
}

/**
 * The sanitiser's output with the browser-view check switched off: the real
 * module, loaded on its own with parse5 answering every parse made against a
 * context element with an empty fragment, so nothing is ever refused.
 */
function sanitisedWithCheckOff(html: string): string {
  let sanitise: (input: string) => string = () => '';
  jest.isolateModules(() => {
    const actual = jest.requireActual<typeof import('parse5')>('parse5');
    jest.doMock('parse5', () => ({
      ...actual,
      parseFragment: (first: unknown) =>
        typeof first === 'string' ? actual.parseFragment(first) : actual.parseFragment(''),
    }));
    sanitise = jest.requireActual<typeof import('./sanitise-template')>('./sanitise-template').sanitiseTemplate;
  });
  jest.dontMock('parse5');
  return sanitise(html);
}

describe('sanitiseTemplate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Preservation tests ──────────────────────────────────────────────────────

  it('passes through clean HTML unchanged', () => {
    const html = '<div><p>Hello <span>world</span></p></div>';
    expect(sanitiseTemplate(html)).toBe(html);
  });

  it('preserves <style> blocks', () => {
    const html = '<style>.card { color: var(--primary); }</style>';
    expect(sanitiseTemplate(html)).toBe(html);
  });

  it('preserves inline SVG elements', () => {
    const html =
      '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="50" cy="50" r="40" fill="red" />' +
      '<rect x="10" y="10" width="30" height="30" fill="blue" />' +
      '<path d="M10 80 Q 95 10 180 80" stroke="black" />' +
      '<g transform="translate(10,10)"><text x="0" y="0" fill="black">Hi</text></g>' +
      '</svg>';

    const result = sanitiseTemplate(html);

    expect(result).toContain('<svg');
    expect(result).toContain('<circle');
    expect(result).toContain('<rect');
    expect(result).toContain('<path');
    expect(result).toContain('<g');
    expect(result).toContain('<text');
    // sanitize-html lowercases attribute names; browsers accept lowercase for SVG in HTML5
    expect(result).toContain('viewbox');
    expect(result).toContain('transform');
  });

  it('preserves <link> tags for Google Fonts', () => {
    const html =
      '<link href="https://fonts.googleapis.com/css2?family=Roboto" rel="stylesheet" crossorigin="anonymous" />';

    const result = sanitiseTemplate(html);

    expect(result).toContain('<link');
    expect(result).toContain('href="https://fonts.googleapis.com/css2?family=Roboto"');
    expect(result).toContain('rel="stylesheet"');
    expect(result).toContain('crossorigin="anonymous"');
  });

  it('preserves Handlebars syntax', () => {
    const html =
      '<div>{{#if active}}<p>{{name}}</p>{{else}}<p>N/A</p>{{/if}}</div>' +
      '<ul>{{#each items}}<li>{{this}}</li>{{/each}}</ul>' +
      '{{#with context}}<span>{{value}}</span>{{/with}}';

    expect(sanitiseTemplate(html)).toBe(html);
  });

  it('preserves semantic HTML5 elements', () => {
    const html =
      '<header><nav>Nav</nav></header>' +
      '<main><article><section>Content</section></article></main>' +
      '<aside><figure><figcaption>Caption</figcaption></figure></aside>' +
      '<footer>Footer</footer>';

    expect(sanitiseTemplate(html)).toBe(html);
  });

  it('preserves <a> tags with href, target, rel, and aria-* attributes', () => {
    const html = '<a href="https://example.com" target="_blank" rel="noopener" aria-label="Example">Link</a>';

    expect(sanitiseTemplate(html)).toBe(html);
  });

  // ── Stripping tests ─────────────────────────────────────────────────────────

  it('strips <script> tags', () => {
    const html = '<div>Hello</div><script>alert("xss")</script>';

    const result = sanitiseTemplate(html);

    expect(result).not.toContain('<script');
    expect(result).not.toContain('alert');
    expect(result).toContain('<div>Hello</div>');
  });

  it('strips event handler attributes', () => {
    const html = '<img src="x.png" onerror="alert(1)" onclick="steal()" onload="track()" />';

    const result = sanitiseTemplate(html);

    expect(result).not.toContain('onerror');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('onload');
    expect(result).toContain('<img');
  });

  it('strips javascript: URIs from href', () => {
    const html = '<a href="javascript:alert(1)">Click me</a>';

    const result = sanitiseTemplate(html);

    expect(result).not.toContain('javascript:');
  });

  it('strips <iframe> tags', () => {
    const html = '<div>Content</div><iframe src="https://evil.com"></iframe>';

    const result = sanitiseTemplate(html);

    expect(result).not.toContain('<iframe');
    expect(result).toContain('<div>Content</div>');
  });

  it('strips <form> and form elements', () => {
    const html =
      '<form action="/steal"><input type="text" /><button>Submit</button><select><option>A</option></select><textarea>B</textarea></form>';

    const result = sanitiseTemplate(html);

    expect(result).not.toContain('<form');
    expect(result).not.toContain('<input');
    expect(result).not.toContain('<button');
    expect(result).not.toContain('<select');
    expect(result).not.toContain('<textarea');
  });

  // Raw-text payloads from GHSA-rpr9-rxv7-x643. Our nonTextTags list leaves out
  // `textarea`, which sanitize-html 2.17.4 alone did not cover: these came back
  // as live markup until 2.17.5.
  it.each([
    ['<xmp><script>alert(1)</script></xmp>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
    ['<xmp><img src=x onerror=alert(1)></xmp>', '&lt;img src=x onerror=alert(1)&gt;'],
    ['<xmp><svg><script>alert(1)</script></svg></xmp>', '&lt;svg&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;/svg&gt;'],
    ['<textarea><script>alert(1)</script></textarea>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ])('keeps raw-text content inert: %s', (html, expected) => {
    const result = sanitiseTemplate(html);

    expect(result).not.toMatch(/<(script|img|svg)\b/i);
    expect(result).toBe(expected);
  });

  it('keeps http and https image srcset candidates', () => {
    const html =
      '<img src="https://example.com/a.png" srcset="https://example.com/a.png 1x, http://example.com/b.png 2x" />';

    expect(sanitiseTemplate(html)).toBe(html);
  });

  it('drops a javascript: srcset candidate', () => {
    const html =
      '<img src="https://example.com/a.png" srcset="https://example.com/a.png 1x, javascript:alert(1) 2x" />';

    expect(sanitiseTemplate(html)).toBe(
      '<img src="https://example.com/a.png" srcset="https://example.com/a.png 1x" />',
    );
  });

  // ── Markup inside <style> ───────────────────────────────────────────────────

  // Inside inline SVG a browser parses <style> content as markup, while the
  // sanitiser treats it as raw text. Text the sanitiser decodes or carries
  // through can then become an element, or close the <style> early so that
  // what follows is built as elements. Each row builds something runnable when
  // the browser-view check is off, and is refused with it on.
  it.each([
    ['escaped markup inside an SVG style element', '<svg><style>&lt;img src=x onerror=alert(1)&gt;</style></svg>'],
    [
      'an entity-encoded closing boundary in SVG',
      '<svg><style>&lt;/style&gt;&lt;img src=x onerror=alert(1)&gt;</style></svg>',
    ],
    [
      'an entity-encoded closing boundary in SVG nested in SVG',
      '<svg><svg><style>&lt;/style&gt;&lt;img src=x onerror=alert(1)&gt;</style></svg></svg>',
    ],
    ['a CDATA closing boundary in SVG', '<svg><style><![CDATA[</style><img src=x onerror=alert(1)>]]></style></svg>'],
    [
      'a CDATA closing boundary in SVG nested in SVG',
      '<svg><svg><style><![CDATA[</style><img src=x onerror=alert(1)>]]></style></svg></svg>',
    ],
    [
      'a foreignObject built inside an SVG style element',
      '<svg><style>&lt;foreignObject&gt;&lt;img src=x onerror=alert(1)&gt;&lt;/foreignObject&gt;</style></svg>',
    ],
    [
      'a mixed-case SVG style closing boundary',
      '<Svg><STYLE>&lt;/STYLE&gt;&lt;img src=x onerror=alert(1)&gt;</STYLE></Svg>',
    ],
    [
      'a link with a disallowed scheme built through a closing boundary',
      '<svg><style>&lt;/style&gt;&lt;a href="javascript:alert(1)"&gt;x&lt;/a&gt;</style></svg>',
    ],
  ])('refuses %s', (_label, html) => {
    expect(runnableInDiv(sanitisedWithCheckOff(html))).not.toEqual([]);
    expect(runnableAfterSanitising(html)).toBe('refused');
  });

  it('names the reason for a refusal without repeating the template', () => {
    const html = '<svg><style>&lt;/style&gt;&lt;img src=x onerror=alert(1)&gt;</style></svg>';

    expect(() => sanitiseTemplate(html)).toThrow(/would build an element, attribute or link/);
    expect(() => sanitiseTemplate(html)).not.toThrow(/onerror|alert/);
  });

  it('accepts markup in an SVG style element when the browser builds only allowed elements and attributes', () => {
    const html = '<svg><style><img src=x onerror=alert(1)></style></svg>';

    expect(runnableAfterSanitising(html)).toEqual([]);
  });

  it.each([
    ['a range media query', '<style>@media (width < 600px) { p { color: red; } }</style>'],
    ['a CSS comment holding "<"', '<style>/* a < b */ p { color: red; }</style>'],
    ['a content string holding "<"', '<style>p::before { content: "<"; }</style>'],
    ['the legacy comment wrapper', '<style><!-- p { color: red; } --></style>'],
    ['plain CSS inside an SVG style element', '<svg><style>.mark { fill: #003366; }</style></svg>'],
    ['escaped markup inside a plain style element', '<style>&lt;img src=x onerror=alert(1)&gt;</style>'],
    ['markup inside a plain style element', '<style><img src=x onerror=alert(1)></style>'],
  ])('accepts %s unchanged and leaves nothing runnable', (_label, html) => {
    expect(runnableAfterSanitising(html)).toEqual([]);
    expect(sanitiseTemplate(html)).toBe(html);
  });

  it('keeps an SVG clipPath and the elements that use it', () => {
    const html =
      '<svg viewBox="0 0 10 10"><defs><clipPath id="c"><rect width="5" height="5"></rect></clipPath></defs>' +
      '<path d="M0 0" clip-path="url(#c)"></path></svg>';

    const result = sanitiseTemplate(html);

    expect(result).toContain('<clipPath id="c"><rect width="5" height="5"></rect></clipPath>');
    expect(result).toContain('clip-path="url(#c)"');
  });

  // Seeding uploads the bundled templates without sanitising them. The sanitiser
  // only sees a copy that someone submits through the create or update routes.
  // Such a copy must be accepted, keep its Handlebars expressions, its CSS and
  // its data: images when sanitised, and leave nothing runnable, and sanitising
  // that output again must not change it.
  it.each(
    [
      'digital_conformity_credential',
      'digital_facility_record',
      'digital_identity_anchor',
      'digital_product_passport',
      'digital_traceability_event',
    ].map((name) => [name]),
  )('keeps the content of the bundled v0.7.0 %s template and leaves its stored form unchanged', (name) => {
    const bundled = readFileSync(join(__dirname, '../../templates/v0.7.0', name, 'template.hbs'), 'utf8');
    const stored = sanitiseTemplate(bundled);
    const countOf = (text: string, pattern: RegExp) => text.match(pattern)?.length ?? 0;

    expect(countOf(stored, /\{\{/g)).toBe(countOf(bundled, /\{\{/g));

    const styleBodies = [...bundled.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]);
    expect(countOf(stored, /<style\b/gi)).toBe(countOf(bundled, /<style\b/gi));
    for (const css of styleBodies) {
      expect(stored).toContain(css);
    }

    const dataImageSources = bundled.match(/src="data:\{\{[^}]+\}\};base64,\{\{[^}]+\}\}"/g) ?? [];
    expect(dataImageSources).toHaveLength(countOf(bundled, /data:\{\{/g));
    for (const src of dataImageSources) {
      expect(stored).toContain(src);
    }

    expect(runnableAfterSanitising(bundled)).toEqual([]);
    expect(sanitiseTemplate(stored)).toBe(stored);
  });

  // ── Logging tests ───────────────────────────────────────────────────────────

  it('logs warning when content is stripped', () => {
    const html = '<div>Safe</div><script>alert("xss")</script>';

    sanitiseTemplate(html);

    expect(mockWarn).toHaveBeenCalledWith(
      expect.objectContaining({ charsDelta: expect.any(Number) }),
      expect.stringContaining('sanitised'),
    );
  });

  it('does NOT log when content passes through clean', () => {
    const html = '<div><p>Clean content</p></div>';

    sanitiseTemplate(html);

    expect(mockWarn).not.toHaveBeenCalled();
  });
});
