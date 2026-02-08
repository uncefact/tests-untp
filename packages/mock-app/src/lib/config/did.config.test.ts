import { getDidConfig, resetDidConfig } from "./did.config";

describe("did.config", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Restore a clean copy of process.env before each test
    process.env = { ...originalEnv };
    resetDidConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const validEnv = {
    VCKIT_API_URL: "https://vckit.example.com",
    VCKIT_AUTH_TOKEN: "test-token-123",
    DEFAULT_ISSUER_DID: "did:web:example.com:org:123",
  };

  it("returns valid config when all env vars are set", () => {
    Object.assign(process.env, validEnv);

    const config = getDidConfig();

    expect(config).toEqual({
      vckitApiUrl: validEnv.VCKIT_API_URL,
      vckitAuthToken: validEnv.VCKIT_AUTH_TOKEN,
      defaultDid: validEnv.DEFAULT_ISSUER_DID,
    });
  });

  it("throws listing ALL missing vars when none are set", () => {
    delete process.env.VCKIT_API_URL;
    delete process.env.VCKIT_AUTH_TOKEN;
    delete process.env.DEFAULT_ISSUER_DID;

    expect(() => getDidConfig()).toThrow("Missing required DID configuration");

    try {
      getDidConfig();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("VCKIT_API_URL");
      expect(message).toContain("VCKIT_AUTH_TOKEN");
      expect(message).toContain("DEFAULT_ISSUER_DID");
    }
  });

  it("includes .env guidance text in the error message", () => {
    delete process.env.VCKIT_API_URL;
    delete process.env.VCKIT_AUTH_TOKEN;
    delete process.env.DEFAULT_ISSUER_DID;

    expect(() => getDidConfig()).toThrow(
      "Set these in your .env file or environment."
    );
  });

  it("caches config on repeated calls", () => {
    Object.assign(process.env, validEnv);

    const first = getDidConfig();

    // Mutate env after first call — cached value should still be returned
    process.env.VCKIT_API_URL = "https://changed.example.com";

    const second = getDidConfig();

    expect(second).toBe(first);
    expect(second.vckitApiUrl).toBe(validEnv.VCKIT_API_URL);
  });

  it("resetDidConfig() clears the cache so next call re-reads env", () => {
    Object.assign(process.env, validEnv);

    const first = getDidConfig();

    const updatedUrl = "https://updated.example.com";
    process.env.VCKIT_API_URL = updatedUrl;

    resetDidConfig();

    const second = getDidConfig();

    expect(second).not.toBe(first);
    expect(second.vckitApiUrl).toBe(updatedUrl);
  });

  it("throws when VCKIT_API_URL is missing", () => {
    Object.assign(process.env, validEnv);
    delete process.env.VCKIT_API_URL;

    expect(() => getDidConfig()).toThrow("VCKIT_API_URL");
  });

  it("throws when VCKIT_AUTH_TOKEN is missing", () => {
    Object.assign(process.env, validEnv);
    delete process.env.VCKIT_AUTH_TOKEN;

    expect(() => getDidConfig()).toThrow("VCKIT_AUTH_TOKEN");
  });

  it("throws when DEFAULT_ISSUER_DID is missing", () => {
    Object.assign(process.env, validEnv);
    delete process.env.DEFAULT_ISSUER_DID;

    expect(() => getDidConfig()).toThrow("DEFAULT_ISSUER_DID");
  });
});
