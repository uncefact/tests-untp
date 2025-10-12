interface ValidationError {
  keyword: string;
  instancePath: string;
  message?: string;
  params: any;
}

export function formatValidationError(error: ValidationError): string {
  const path = error.instancePath
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace("@", ""))
    .join(" → ");

  switch (error.keyword) {
    case "required":
      if (!error.instancePath) {
        return `Missing required field: ${error.params.missingProperty}`;
      }
      return `Missing required field: ${path} → ${error.params.missingProperty}`;
    case "const":
      const allowedValues = Array.isArray(error.params.allowedValue)
        ? error.params.allowedValue.join(" or ")
        : error.params.allowedValue;
      return `Invalid value for ${
        path || "field"
      }: must be one of [${allowedValues}]`;
    case "enum":
      return `Invalid value for ${
        path || "field"
      }: must be one of [${error.params.allowedValues.join(", ")}]`;
    case "type":
      return `Invalid type for ${path || "field"}: expected ${
        error.params.type
      }`;
    case "format":
      return `Invalid format for ${path || "field"}: must be a valid ${
        error.params.format
      }`;
    case "pattern":
      return `Invalid format for ${path || "field"}: must match pattern ${
        error.params.pattern
      }`;
    case "additionalProperties":
      return `Unknown field: ${error.params.additionalProperty}`;
    default:
      return error.message || "Unknown validation error";
  }
}
