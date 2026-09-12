export interface OtlpTraceExporterOptions {
  url: string;
}

export function buildOtlpTraceExporterOptions(
  env: Record<string, string | undefined> = process.env,
): OtlpTraceExporterOptions {
  return {
    url: env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4317',
  };
}
