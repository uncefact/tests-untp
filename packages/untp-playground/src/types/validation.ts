export interface ValidationError {
  keyword: string;
  instancePath: string;
  message: string;
  params?: Record<string, any>;
  // AJV verbose mode populates `data` with the actual value at instancePath.
  data?: unknown;
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

/** An error shown against a test step. `supportable` offers the support link, so it stays false for faults the uploader can correct in their own document. */
export interface DisplayableError {
  message: string;
  supportable?: boolean;
}
