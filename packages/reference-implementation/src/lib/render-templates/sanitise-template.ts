import sanitizeHtml from 'sanitize-html';
import parseSrcset from 'parse-srcset';
import { parseFragment } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
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
  // sanitize-html 2.18 keeps SVG's case-adjusted name inside <svg>, so the
  // lower-case entry alone no longer matches and the element was dropped.
  'clipPath',
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
    clipPath: ['id'],
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

// The allowlist the browser view is checked against, read from
// SANITISE_OPTIONS (and sanitize-html's defaults where the options leave a
// setting out) so that there is one list. Names are compared in lower case:
// sanitize-html lower-cases them, while a browser case-adjusts SVG names
// (`clipPath`, `viewBox`).
const ALLOWED_TAG_NAMES = new Set(
  (Array.isArray(SANITISE_OPTIONS.allowedTags) ? SANITISE_OPTIONS.allowedTags : []).map((tag) => tag.toLowerCase()),
);

/** An attribute name as a pattern; sanitize-html treats `*` as a wildcard (`aria-*`). */
function attributeNamePattern(name: string): RegExp {
  const escaped = name.toLowerCase().replace(/[.+?^$()|[\]{}\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
}

const ALLOWED_ATTRIBUTE_PATTERNS = new Map<string, RegExp[]>();
for (const [tag, entries] of Object.entries(SANITISE_OPTIONS.allowedAttributes || {})) {
  const patterns = entries.map((entry) => attributeNamePattern(typeof entry === 'string' ? entry : entry.name));
  // `clippath` and `clipPath` fold to one key; their lists are combined.
  const key = tag.toLowerCase();
  ALLOWED_ATTRIBUTE_PATTERNS.set(key, [...(ALLOWED_ATTRIBUTE_PATTERNS.get(key) ?? []), ...patterns]);
}

const SCHEME_CHECKED_ATTRIBUTES = new Set(
  SANITISE_OPTIONS.allowedSchemesAppliedToAttributes ?? sanitizeHtml.defaults.allowedSchemesAppliedToAttributes,
);

function isAllowedAttribute(tag: string, attribute: string): boolean {
  return [tag, '*'].some((key) =>
    (ALLOWED_ATTRIBUTE_PATTERNS.get(key) ?? []).some((pattern) => pattern.test(attribute)),
  );
}

/**
 * Whether a URL attribute's value is allowed for the tag, by the same rule
 * sanitize-html applies: a value with no scheme (relative or protocol-relative)
 * passes, and a scheme must be in the tag's `allowedSchemesByTag` list, or in
 * `allowedSchemes` for a tag without one. Whitespace and control characters
 * are removed first, as a browser ignores them when it reads the scheme.
 */
function hasAllowedScheme(tag: string, value: string): boolean {
  // eslint-disable-next-line no-control-regex -- control characters are what this removes
  const scheme = /^([a-z][a-z0-9.+-]*):/i.exec(value.replace(/[\u0000-\u0020]+/g, ''))?.[1]?.toLowerCase();
  if (scheme === undefined) return true;
  const byTag = typeof SANITISE_OPTIONS.allowedSchemesByTag === 'object' ? SANITISE_OPTIONS.allowedSchemesByTag : {};
  const allowed =
    byTag[tag] ??
    (Array.isArray(SANITISE_OPTIONS.allowedSchemes)
      ? SANITISE_OPTIONS.allowedSchemes
      : sanitizeHtml.defaults.allowedSchemes);
  return allowed.includes(scheme);
}

/**
 * Whether every candidate URL in a srcset value has a scheme allowed for the
 * tag. sanitize-html checks srcset candidates one by one, with the same parser
 * (parse-srcset) and the same per-tag schemes as `src`, so this does too.
 *
 * parse-srcset leaves out a candidate it cannot parse rather than failing, so
 * a value whose every candidate is invalid comes back empty. That value is
 * refused, because its URLs were never checked. A blank or whitespace-only
 * value has no candidates to check and is accepted, as before.
 */
function hasAllowedSrcsetSchemes(tag: string, value: string): boolean {
  const candidates = parseSrcset(value);
  if (candidates.length === 0 && value.replace(/[\t\n\f\r ]+/g, '') !== '') return false;
  return candidates.every((candidate) => hasAllowedScheme(tag, candidate.url));
}

/** A div element for parse5 to parse the template as that element's content. */
const DIV_CONTEXT = parseFragment('<div></div>').childNodes[0] as DefaultTreeAdapterMap['element'];

/**
 * What a browser would build from the sanitised template that is outside the
 * allowlist, as a short description (`element foreignobject`), or `null` when
 * everything it builds is allowed.
 *
 * sanitize-html checks the markup it reads, but a browser reads the output
 * again with the HTML parsing rules. Inside inline SVG those rules treat
 * `<style>` content as markup, and text the sanitiser decoded or carried
 * through can close the `<style>` early, so the browser can build elements and
 * event-handler attributes the sanitiser never saw. This parses the output the
 * way `innerHTML` on a div does (the parse5 fragment algorithm with a div
 * context) and checks every element it builds, including SVG content and
 * `<template>` content, against the same tag, attribute and URL scheme
 * allowlist the sanitiser applies. CSS text is not inspected: a `<` in a
 * stylesheet is accepted when it builds nothing outside the allowlist.
 *
 * This checks the template string that is stored. It does not see the HTML
 * Handlebars produces when a credential is rendered with the template.
 */
function disallowedInBrowserView(html: string): string | null {
  const pending: DefaultTreeAdapterMap['childNode'][] = [...parseFragment(DIV_CONTEXT, html, {}).childNodes];
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (!('tagName' in node)) continue;
    const tag = node.tagName.toLowerCase();
    if (!ALLOWED_TAG_NAMES.has(tag)) return `element ${tag}`;
    for (const attribute of node.attrs) {
      const name = (attribute.prefix ? `${attribute.prefix}:${attribute.name}` : attribute.name).toLowerCase();
      if (!isAllowedAttribute(tag, name)) return `attribute ${name} on ${tag}`;
      // Schemes are checked by the attribute's local name, so `xlink:href`
      // is held to the same rule as `href`.
      const localName = attribute.name.toLowerCase();
      if (SCHEME_CHECKED_ATTRIBUTES.has(localName) && !hasAllowedScheme(tag, attribute.value)) {
        return `URL scheme in ${name} on ${tag}`;
      }
      if (localName === 'srcset' && !hasAllowedSrcsetSchemes(tag, attribute.value)) {
        return `URL scheme in ${name} on ${tag}`;
      }
    }
    // One at a time: spreading a very wide element's children into push()
    // exceeds the engine's argument limit and throws a RangeError.
    for (const child of node.childNodes) pending.push(child);
    if ('content' in node) {
      for (const child of node.content.childNodes) pending.push(child);
    }
  }
  return null;
}

/**
 * Sanitise an HTML template string, stripping dangerous elements and attributes
 * while preserving the feature set that render templates require.
 *
 * @throws ValidationError when a browser parsing the sanitised template would
 *   build an element, attribute or URL scheme outside the allowlist (see
 *   {@link disallowedInBrowserView}). The template is refused rather than
 *   altered, and the message does not repeat its content.
 */
export function sanitiseTemplate(html: string): string {
  const result = sanitizeHtml(html, SANITISE_OPTIONS);

  const delta = html.length - result.length;
  if (delta > 0) {
    logger.warn({ charsDelta: delta }, 'Template content was sanitised: %d characters stripped');
  }

  const disallowed = disallowedInBrowserView(result);
  if (disallowed !== null) {
    logger.warn({ disallowed }, 'Template refused: the browser view of the sanitised template is outside the allowlist');
    throw new ValidationError(
      'Template refused: a browser reading the sanitised template would build an element, attribute or link that render templates do not allow. Check the markup inside <style> elements, especially in inline SVG.',
    );
  }

  return result;
}
