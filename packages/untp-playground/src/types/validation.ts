export interface ValidationError {
  keyword: string;
  instancePath: string;
  message: string;
  params?: Record<string, any>;
}

export interface CombinedValidationRule<T = any> {
  predicate: (value: T) => boolean | Promise<boolean>;
  keyword: string;
  message: string;
  instancePath: string;
  params?: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}
