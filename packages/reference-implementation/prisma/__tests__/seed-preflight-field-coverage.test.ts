import { z } from 'zod';
import { adapterRegistry, ServiceType } from '@uncefact/untp-ri-services';
import { IDR_FIELD_TO_ENV, STORAGE_FIELD_TO_ENV, VC_FIELD_TO_ENV } from '../seed-preflight';

/**
 * The preflight's field-to-env maps are hand-maintained, with nothing
 * binding them to the adapter schemas they describe. A required field
 * added upstream without a matching map entry would silently reclassify
 * its category from 'missing' to 'other' (see `classifyParse` in
 * `seed-preflight.ts`): the field's own `invalid_type` issue still fires,
 * but with no env var to attribute it to, the whole category falls back
 * to the non-fail-loud bucket. This derives each adapter's required
 * fields directly from its own zod schema, so that drift fails here
 * rather than silently at boot.
 */
function requiredFields(schema: z.ZodObject<z.ZodRawShape>): string[] {
  return Object.entries(schema.shape)
    .filter(([, field]) => !field.isOptional())
    .map(([key]) => key);
}

describe('seed-preflight field-to-env maps cover every required adapter field', () => {
  it('IDR (Pyx) adapter', () => {
    const schema = adapterRegistry[ServiceType.IDR].PYX_IDR.configSchema;
    const required = requiredFields(schema);

    expect(required.length).toBeGreaterThan(0);
    for (const field of required) {
      expect(IDR_FIELD_TO_ENV).toHaveProperty(field);
    }
  });

  it('storage (UNCEFACT) adapter', () => {
    const schema = adapterRegistry[ServiceType.STORAGE].UNCEFACT_STORAGE.configSchema;
    const required = requiredFields(schema);

    expect(required.length).toBeGreaterThan(0);
    for (const field of required) {
      expect(STORAGE_FIELD_TO_ENV).toHaveProperty(field);
    }
  });

  it('VC (VCKit) adapter', () => {
    const schema = adapterRegistry[ServiceType.VC].VCKIT.configSchema;
    const required = requiredFields(schema);

    expect(required.length).toBeGreaterThan(0);
    for (const field of required) {
      expect(VC_FIELD_TO_ENV).toHaveProperty(field);
    }
  });
});
