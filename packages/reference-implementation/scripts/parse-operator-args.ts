import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';

export function parseOperatorArgs(args: string[], options: ParseArgsOptionsConfig) {
  const parsed = parseArgs({
    args: args[0] === '--' ? args.slice(1) : args,
    options,
    tokens: true,
    strict: true,
    allowPositionals: false,
  });
  const seen = new Set<string>();
  for (const token of parsed.tokens ?? []) {
    if (token.kind !== 'option') continue;
    if (seen.has(token.name)) throw new Error(`--${token.name} must be supplied only once.`);
    seen.add(token.name);
  }
  return parsed;
}
