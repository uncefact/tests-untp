/**
 * Small readers over the generated OpenAPI document, shared by the suites
 * that pin published operations. They live beside the generator rather than
 * inside one suite so two suites cannot drift into two readings of the same
 * document shape.
 */

/**
 * A description as one line. Swagger descriptions are written as wrapped
 * blocks, so a sentence in the source carries line breaks that no assertion
 * about its wording should have to know about.
 */
export function oneLine(text: string | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ');
}
