/**
 * Small readers over the generated OpenAPI document, shared by the suites
 * that pin published operations. They live beside the generator rather than
 * inside one suite so two suites cannot drift into two readings of the same
 * document shape.
 */

/**
 * A description as one line. Swagger descriptions are written as wrapped
 * blocks, so a sentence in the source carries line breaks that no assertion
 * about its wording should have to know about.
 */
export function oneLine(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ');
}

/** The subset of a generated JSON Schema node the collector walks. */
export type AdditionalPropertiesNode = {
  properties?: Record<string, AdditionalPropertiesNode>;
  items?: AdditionalPropertiesNode;
  additionalProperties?: unknown;
};

/**
 * Every `additionalProperties` the generator emitted anywhere under `node`,
 * including inside array items, so a request component can be checked for a
 * documented rejection of unknown keys at any nesting level. A route that
 * strips unknown keys at runtime must not publish `false` at any of them.
 */
export function collectAdditionalProperties(
  node: AdditionalPropertiesNode | undefined,
  acc: unknown[] = [],
): unknown[] {
  if (!node) return acc;
  if ('additionalProperties' in node) acc.push(node.additionalProperties);
  Object.values(node.properties ?? {}).forEach((child) => collectAdditionalProperties(child, acc));
  collectAdditionalProperties(node.items, acc);
  return acc;
}
