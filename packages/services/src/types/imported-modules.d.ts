declare module 'digiatllink_toolkit_server/src/GS1DigitalLinkToolkit.js' {
  export default class GS1DigitalLinkToolkit {
    constructor();
    gs1ElementStringsToGS1DigitalLink(elementString: string, useShortText?: boolean, uriStem?: string): string;
    extractFromGS1elementStrings(elementStrings: string): object;
  }
}
