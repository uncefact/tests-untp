import fs from 'node:fs';
import path from 'node:path';

const PACKAGE_NAME = 'untp-reference-implementation';

/**
 * The reference implementation's own version for `service.version`, or
 * `undefined` with the reason when it cannot be found. The observability
 * resource reads `../../../package.json` from its module, which in the
 * flattened image is the repository root's `package.json` (0.2.0, not this
 * package's). The worker resolves the package by name instead, from the two
 * places it lives: the package root in the checkout, and the path Next's
 * standalone output puts it at in the image. A candidate that exists but is
 * not this package, or does not parse, is passed over. Nothing here fails
 * the boot: the value is a telemetry attribute, and a worker that refuses
 * to run jobs over it would be guarding the wrong thing. The caller logs the
 * reason and reports `unknown`.
 */
export function readReferenceImplementationVersion(fromDir: string): { version: string } | { reason: string } {
  const candidates = [
    path.resolve(fromDir, '../../package.json'),
    path.resolve(fromDir, '../../packages/reference-implementation/package.json'),
  ];
  const passedOver: string[] = [];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
    } catch (error) {
      passedOver.push(`${candidate} (not valid JSON: ${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      passedOver.push(`${candidate} (not a package manifest)`);
      continue;
    }
    const manifest = parsed as { name?: unknown; version?: unknown };
    if (manifest.name !== PACKAGE_NAME) {
      passedOver.push(`${candidate} (package ${String(manifest.name)})`);
      continue;
    }
    if (typeof manifest.version !== 'string' || manifest.version.trim() === '') {
      passedOver.push(`${candidate} (no version)`);
      continue;
    }
    return { version: manifest.version };
  }
  return {
    reason: `no package.json named ${PACKAGE_NAME} at ${candidates.join(' or ')}${
      passedOver.length > 0 ? `; passed over ${passedOver.join(', ')}` : ''
    }`,
  };
}
