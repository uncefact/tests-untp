import sanitizeHtml from 'sanitize-html';
import { Parser } from 'htmlparser2';
import { appLogger } from '@/lib/api/logger';
import { ValidationError } from '@/lib/api/validation';

const logger = appLogger.child({ module: 'sanitise-template' });

/**
 * Tags to add beyond sanitize-html defaults.
 *
 * Defaults already cover semantic HTML5, standard formatting, tables, and lists.
 * We extend with document structure, inline SVG, `<style>` (CSS), `<link>`
 * (Google Fonts), and `<img>`.
 */
const EXTRA_TAGS = [
  // Document structure
  'html',
  'head',
  'body',
  // Images
  'img',
  // Inline SVG
  'svg',
  'path',
  'circle',
  'rect',
  'g',
  'defs',
  'clippath',
  'text',
  // CSS and external resources
  'style',
  'link',
];

/**
 * sanitize-html options for Handlebars render templates.
 *
 * Extends library defaults (which already block script, iframe, form, event
 * handlers, and javascript: URIs) with the tags and attributes our templates
 * need. Handlebars syntax (`{{...}}`) is plain text so passes through untouched.
 *
 * CSS inside `<style>` blocks — including `:root` custom properties and `var()`
 * — is preserved verbatim via the `nonTextTags` setting.
 */
const SANITISE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(EXTRA_TAGS),

  allowedAttributes: {
    // Global attributes available on every element
    '*': ['class', 'id', 'style', 'title', 'aria-*', 'data-*'],

    // Extend default a/img attributes
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
    link: ['href', 'rel', 'crossorigin'],

    // SVG attributes (sanitize-html lowercases names; browsers accept lowercase in HTML5)
    svg: ['viewbox', 'xmlns', 'width', 'height', 'fill', 'stroke'],
    path: ['d', 'fill', 'stroke', 'transform', 'clip-path'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'transform', 'clip-path'],
    rect: ['x', 'y', 'rx', 'ry', 'width', 'height', 'fill', 'stroke', 'transform', 'clip-path'],
    g: ['transform', 'fill', 'stroke', 'clip-path'],
    clippath: ['id'],
    text: ['x', 'y', 'fill', 'stroke', 'transform'],
  },

  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
  },

  // Required to allow <style> — acknowledged trade-off for CSS-based templates.
  allowVulnerableTags: true,

  // <style> content (CSS) is preserved verbatim; <script> content is dropped with the tag.
  nonTextTags: ['style', 'script'],
};

/**
 * Whether any `<style>` element in the given HTML carries markup: a `<` in its
 * text, or an element opened inside it.
 *
 * sanitize-html treats every `<style>` as raw text and never inspects what it
 * holds. A browser does the same in the HTML body, but inside inline SVG it
 * parses `<style>` content as markup, so a `<` there can start a live element
 * with event handlers that the sanitiser let through. The parser reports
 * either form: as text where it treats `<style>` as raw text, and as an opened
 * element where it follows the SVG parsing rules. CSS has no need of the
 * character, so neither form is accepted.
 */
function styleCarriesMarkup(html: string): boolean {
  let styleDepth = 0;
  let found = false;
  const parser = new Parser(
    {
      onopentag(name) {
        if (styleDepth > 0) found = true;
        if (name === 'style') styleDepth += 1;
      },
      ontext(text) {
        if (styleDepth > 0 && text.includes('<')) found = true;
      },
      onclosetag(name) {
        if (name === 'style' && styleDepth > 0) styleDepth -= 1;
      },
    },
    { decodeEntities: false },
  );
  parser.write(html);
  parser.end();
  return found;
}

/**
 * Sanitise an HTML template string, stripping dangerous elements and attributes
 * while preserving the feature set that render templates require.
 *
 * @throws ValidationError when the sanitised template has markup inside a
 *   `<style>` element (see {@link styleCarriesMarkup}). The template is refused
 *   rather than altered, and the message does not repeat its content.
 */
export function sanitiseTemplate(html: string): string {
  const result = sanitizeHtml(html, SANITISE_OPTIONS);

  const delta = html.length - result.length;
  if (delta > 0) {
    logger.warn({ charsDelta: delta }, 'Template content was sanitised: %d characters stripped');
  }

  if (styleCarriesMarkup(result)) {
    logger.warn('Template refused: a style element carries markup');
    throw new ValidationError(
      'Template refused: a <style> element contains markup or a "<" character, which a browser can run as HTML inside inline SVG. Remove it from the CSS.',
    );
  }

  return result;
}
