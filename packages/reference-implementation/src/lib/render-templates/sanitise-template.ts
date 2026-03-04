import sanitizeHtml from 'sanitize-html';
import { apiLogger } from '@/lib/api/logger';

const logger = apiLogger.child({ module: 'sanitise-template' });

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
 * Sanitise an HTML template string, stripping dangerous elements and attributes
 * while preserving the feature set that render templates require.
 */
export function sanitiseTemplate(html: string): string {
  const result = sanitizeHtml(html, SANITISE_OPTIONS);

  const delta = html.length - result.length;
  if (delta > 0) {
    logger.warn({ charsDelta: delta }, 'Template content was sanitised: %d characters stripped');
  }

  return result;
}
