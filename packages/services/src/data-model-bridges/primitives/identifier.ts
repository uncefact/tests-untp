export type IdentifierScheme = {
  type: ['IdentifierScheme'];
  id: string;
  name: string;
};

export function buildIdentifierScheme(
  scheme: { id?: string; name?: string } | null | undefined,
): IdentifierScheme | undefined {
  if (!scheme || !scheme.id || !scheme.name) return undefined;
  return {
    type: ['IdentifierScheme'],
    id: scheme.id,
    name: scheme.name,
  };
}
