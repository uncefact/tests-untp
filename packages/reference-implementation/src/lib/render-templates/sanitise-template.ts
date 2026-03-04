import sanitizeHtml from 'sanitize-html';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ module: 'sanitise-template' });

/**
 * Allowed tags for Handlebars-based render templates.
 *
 * Covers semantic HTML5, standard formatting, tables, lists, inline SVG,
 * `<style>` blocks, and `<link>` elements (Google Fonts).
 */
const ALLOWED_TAGS = [
  // Semantic HTML5
  'html',
  'head',
  'body',
  'header',
  'section',
  'footer',
  'main',
  'nav',
  'article',
  'aside',
  'figure',
  'figcaption',

  // Standard block/inline elements
  'div',
  'span',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'img',
  'br',
  'hr',
  'strong',
  'em',
  'b',
  'i',
  'u',
  'small',
  'sub',
  'sup',
  'blockquote',
  'pre',
  'code',

  // Tables
  'table',
  'tr',
  'td',
  'th',
  'thead',
  'tbody',
  'tfoot',

  // Lists
  'ul',
  'ol',
  'li',

  // Inline SVG
  'svg',
  'path',
  'circle',
  'rect',
  'g',
  'defs',
  'clippath',
  'text',

  // Style and external resources
  'style',
  'link',
];

/**
 * sanitize-html options tailored for Handlebars render templates.
 *
 * Handlebars syntax (`{{...}}`) is plain text from the parser's perspective,
 * so it passes through untouched without special handling.
 */
const SANITISE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,

  allowedAttributes: {
    // Global attributes available on every element
    '*': ['class', 'id', 'style', 'title', 'aria-*', 'data-*'],

    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height'],
    link: ['href', 'rel', 'crossorigin'],

    // SVG attributes (sanitize-html lowercases attribute names, browsers accept lowercase for SVG in HTML5)
    svg: ['viewbox', 'xmlns', 'width', 'height', 'fill', 'stroke'],
    path: ['d', 'fill', 'stroke', 'transform', 'clip-path'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'transform', 'clip-path'],
    rect: ['x', 'y', 'rx', 'ry', 'width', 'height', 'fill', 'stroke', 'transform', 'clip-path'],
    g: ['transform', 'fill', 'stroke', 'clip-path'],
    clippath: ['id'],
    text: ['x', 'y', 'fill', 'stroke', 'transform'],
  },

  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    img: ['http', 'https', 'data'],
  },

  // We intentionally allow <style> for CSS-based templates — acknowledged as a conscious trade-off.
  allowVulnerableTags: true,
  enforceHtmlBoundary: false,

  // Treat <style> and <script> content as non-text so inner content is discarded
  // with the tag rather than leaking into output.  <style> is allowed so its CSS
  // is preserved verbatim; <script> is disallowed and its content is dropped.
  nonTextTags: ['style', 'script'],
};

/**
 * Sanitise an HTML template string, stripping dangerous elements and attributes
 * while preserving the rich feature set that render templates require.
 */
export function sanitiseTemplate(html: string): string {
  const result = sanitizeHtml(html, SANITISE_OPTIONS);

  const delta = html.length - result.length;
  if (delta > 0) {
    logger.warn({ charsDelta: delta }, 'Template content was sanitised: %d characters stripped');
  }

  return result;
}
