const mockWarn = jest.fn();
jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: mockWarn, error: jest.fn() }) },
}));

import { sanitiseTemplate } from './sanitise-template';

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
