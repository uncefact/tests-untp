import { RenderMethodType } from '@/lib/prisma/generated';
import { ValidationError } from '@/lib/api/validation';
import { validateRenderMethodFields, RenderMethodFields } from './validate-render-method-fields';

describe('validateRenderMethodFields', () => {
  describe('RenderTemplate2024', () => {
    const type = RenderMethodType.RenderTemplate2024;

    it('applies default inline = false when not provided', () => {
      const result = validateRenderMethodFields(type, {});
      expect(result.inline).toBe(false);
    });

    it('applies default mediaType = "text/html" when not provided', () => {
      const result = validateRenderMethodFields(type, {});
      expect(result.mediaType).toBe('text/html');
    });

    it('sets mediaQuery to null when not provided', () => {
      const result = validateRenderMethodFields(type, {});
      expect(result.mediaQuery).toBeNull();
    });

    // An explicit null is what a PATCH sends to reset these fields, and it is
    // a different input from an absent one even though both land on the
    // defaults here. The API documents the reset, so it needs its own case.
    it('treats an explicit null mediaType as a reset to the default', () => {
      const result = validateRenderMethodFields(type, { mediaType: null });
      expect(result.mediaType).toBe('text/html');
    });

    it('treats an explicit null mediaQuery as a clear', () => {
      const result = validateRenderMethodFields(type, { mediaQuery: null });
      expect(result.mediaQuery).toBeNull();
    });

    it('passes through provided inline value', () => {
      const result = validateRenderMethodFields(type, { inline: true });
      expect(result.inline).toBe(true);
    });

    it('passes through provided mediaType value', () => {
      const result = validateRenderMethodFields(type, { mediaType: 'application/json' });
      expect(result.mediaType).toBe('application/json');
    });

    it('passes through provided mediaQuery value', () => {
      const result = validateRenderMethodFields(type, { mediaQuery: '(max-width: 600px)' });
      expect(result.mediaQuery).toBe('(max-width: 600px)');
    });

    it('returns complete ValidatedRenderMethodFields object with all values provided', () => {
      const fields: RenderMethodFields = {
        inline: true,
        mediaType: 'text/plain',
        mediaQuery: '(min-width: 1024px)',
      };
      const result = validateRenderMethodFields(type, fields);
      expect(result).toEqual({
        inline: true,
        mediaType: 'text/plain',
        mediaQuery: '(min-width: 1024px)',
      });
    });

    it('returns complete ValidatedRenderMethodFields object with defaults when no fields provided', () => {
      const result = validateRenderMethodFields(type, {});
      expect(result).toEqual({
        inline: false,
        mediaType: 'text/html',
        mediaQuery: null,
      });
    });
  });

  describe('WebRenderingTemplate2022', () => {
    const type = RenderMethodType.WebRenderingTemplate2022;

    it('returns all-null fields when no extra fields are provided', () => {
      const result = validateRenderMethodFields(type, {});
      expect(result).toEqual({
        inline: null,
        mediaType: null,
        mediaQuery: null,
      });
    });

    it('throws ValidationError when inline is provided', () => {
      expect(() => validateRenderMethodFields(type, { inline: true })).toThrow(ValidationError);
      expect(() => validateRenderMethodFields(type, { inline: true })).toThrow(
        'Fields not applicable to WebRenderingTemplate2022: inline',
      );
    });

    it('throws ValidationError when mediaType is provided', () => {
      expect(() => validateRenderMethodFields(type, { mediaType: 'text/html' })).toThrow(ValidationError);
      expect(() => validateRenderMethodFields(type, { mediaType: 'text/html' })).toThrow(
        'Fields not applicable to WebRenderingTemplate2022: mediaType',
      );
    });

    it('throws ValidationError when mediaQuery is provided', () => {
      expect(() => validateRenderMethodFields(type, { mediaQuery: '(max-width: 600px)' })).toThrow(ValidationError);
      expect(() => validateRenderMethodFields(type, { mediaQuery: '(max-width: 600px)' })).toThrow(
        'Fields not applicable to WebRenderingTemplate2022: mediaQuery',
      );
    });

    it('throws ValidationError listing all inapplicable fields when multiple are provided', () => {
      expect(() => validateRenderMethodFields(type, { inline: false, mediaType: 'text/html' })).toThrow(
        ValidationError,
      );
      expect(() => validateRenderMethodFields(type, { inline: false, mediaType: 'text/html' })).toThrow(
        'Fields not applicable to WebRenderingTemplate2022: inline, mediaType',
      );
    });

    it('throws ValidationError listing all three fields when all are provided', () => {
      expect(() =>
        validateRenderMethodFields(type, {
          inline: true,
          mediaType: 'text/html',
          mediaQuery: '(min-width: 768px)',
        }),
      ).toThrow(ValidationError);
      expect(() =>
        validateRenderMethodFields(type, {
          inline: true,
          mediaType: 'text/html',
          mediaQuery: '(min-width: 768px)',
        }),
      ).toThrow('Fields not applicable to WebRenderingTemplate2022: inline, mediaType, mediaQuery');
    });
  });
});
