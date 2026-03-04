import { RenderMethodType } from '@/lib/prisma/generated';
import { ValidationError } from '@/lib/api/validation';

export type RenderMethodFields = {
  inline?: boolean | null;
  mediaType?: string | null;
  mediaQuery?: string | null;
};

export type ValidatedRenderMethodFields = {
  inline: boolean | null;
  mediaType: string | null;
  mediaQuery: string | null;
};

const RT2024_FIELDS = ['inline', 'mediaType', 'mediaQuery'] as const;

export function validateRenderMethodFields(
  renderMethodType: RenderMethodType,
  fields: RenderMethodFields,
): ValidatedRenderMethodFields {
  if (renderMethodType === RenderMethodType.WebRenderingTemplate2022) {
    const inapplicable = RT2024_FIELDS.filter((f) => fields[f] !== undefined);
    if (inapplicable.length > 0) {
      throw new ValidationError(`Fields not applicable to WebRenderingTemplate2022: ${inapplicable.join(', ')}`);
    }
    return { inline: null, mediaType: null, mediaQuery: null };
  }

  // RenderTemplate2024: apply defaults
  return {
    inline: fields.inline ?? false,
    mediaType: fields.mediaType ?? 'text/html',
    mediaQuery: fields.mediaQuery ?? null,
  };
}
