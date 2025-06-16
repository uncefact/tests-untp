import { CombinedValidationRule, ValidationError } from '@/types';

/**
 * Runs validation rules (both sync and async) against a value.
 * @param value - The value to validate.
 * @param rules - An array of validation rules.
 * @returns A Promise that resolves to an array of validation errors (empty if none).
 */
export async function validateWithRules<T>(value: T, rules: CombinedValidationRule<T>[]): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];
  for (const rule of rules) {
    let valid: boolean;

    const result = rule.predicate(value);
    valid = result instanceof Promise ? await result : result;

    if (!valid) {
      errors.push({
        keyword: rule.keyword,
        instancePath: rule.instancePath,
        message: rule.message,
        params: rule.params,
      });
    }
  }
  return errors;
}
