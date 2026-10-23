declare module 'parse-srcset' {
  /** One image candidate from a srcset attribute, as parse-srcset 1.0.2 returns it. */
  interface ImageCandidate {
    url: string;
    w?: number;
    h?: number;
    d?: number;
  }

  /**
   * Parses a srcset attribute value with the HTML specification's algorithm.
   * A candidate with an invalid descriptor is left out of the result.
   */
  function parseSrcset(input: string): ImageCandidate[];

  export = parseSrcset;
}
