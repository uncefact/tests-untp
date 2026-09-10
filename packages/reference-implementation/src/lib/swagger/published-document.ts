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

/** The part of a generated schema node that can hold or nest an enum. */
export type EnumNode = {
  enum?: unknown[];
  properties?: Record<string, EnumNode>;
  items?: EnumNode;
  anyOf?: EnumNode[];
  oneOf?: EnumNode[];
  allOf?: EnumNode[];
};

/**
 * Collects enum members through the composition nodes emitted for unions.
 * Returns an empty array for any node it cannot walk, a `$ref` or a missing
 * property included, so an assertion that a member is ABSENT needs a positive
 * control beside it to prove the array was populated at all.
 */
export function collectEnums(node: EnumNode | undefined, acc: unknown[] = []): unknown[] {
  if (!node) return acc;
  if (node.enum) acc.push(...node.enum);
  Object.values(node.properties ?? {}).forEach((child) => collectEnums(child, acc));
  collectEnums(node.items, acc);
  node.anyOf?.forEach((child) => collectEnums(child, acc));
  node.oneOf?.forEach((child) => collectEnums(child, acc));
  node.allOf?.forEach((child) => collectEnums(child, acc));
  return acc;
}
