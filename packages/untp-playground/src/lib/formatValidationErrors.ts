interface ValidationError {
  keyword: string;
  instancePath: string;
  message?: string;
  params: any;
}

/**
 * Splits an AJV `instancePath` (an RFC 6901 JSON Pointer) into its decoded tokens. `~1` and `~0`
 * are unescaped so a key that contains `/` (a URL link relation in a link set) reads as itself,
 * and every token is kept, including empty ones, because dropping tokens moves the reported
 * location to the wrong member.
 */
export function pointerSegments(instancePath: string): string[] {
  if (instancePath === '') return [];
  return instancePath
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));
}

// Tokens are shown as they are (an `@context` member is named `@context`); an empty member name,
// which JSON permits, is shown as `""` so the root and a property called "" stay distinguishable.
function readablePath(instancePath: string): string {
  return pointerSegments(instancePath)
    .map((segment) => (segment === '' ? '""' : segment))
    .join(' → ');
}

// AJV names the offending member in `params`; an empty member name is shown as `""` too.
function memberName(name: unknown): string {
  return name === '' ? '""' : String(name);
}

export function formatValidationError(error: ValidationError): string {
  const path = readablePath(error.instancePath);
  const at = path ? ` at ${path}` : '';

  switch (error.keyword) {
    case 'required':
      if (!error.instancePath) {
        return `Missing required field: ${memberName(error.params.missingProperty)}`;
      }
      return `Missing required field: ${path} → ${memberName(error.params.missingProperty)}`;
    case 'const':
      const allowedValues = Array.isArray(error.params.allowedValue)
        ? error.params.allowedValue.join(' or ')
        : error.params.allowedValue;
      return `Invalid value for ${path || 'field'}: must be one of [${allowedValues}]`;
    case 'enum':
      return `Invalid value for ${path || 'field'}: must be one of [${error.params.allowedValues.join(', ')}]`;
    case 'type':
      return `Invalid type for ${path || 'field'}: expected ${error.params.type}`;
    case 'format':
      return `Invalid format for ${path || 'field'}: must be a valid ${error.params.format}`;
    case 'pattern':
      return `Invalid format for ${path || 'field'}: must match pattern ${error.params.pattern}`;
    case 'additionalProperties':
      return `Unknown field${at}: ${memberName(error.params.additionalProperty)}`;
    default:
      return `${error.message || 'Unknown validation error'}${at}`;
  }
}
