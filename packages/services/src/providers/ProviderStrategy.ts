export interface ProviderStrategy {
  getDlrUrl: () => Promise<string | null>;
  getCode: (decodedText: string, formatName: string) => string;
  setCode: (code: string) => void;
  isProviderSupported(): boolean;
}