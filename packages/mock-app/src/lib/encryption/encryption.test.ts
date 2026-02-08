const originalEnv = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...originalEnv };
});

afterAll(() => {
  process.env = originalEnv;
});

describe("getEncryptionService", () => {
  const VALID_KEY = "a".repeat(64);

  it("throws when SERVICE_ENCRYPTION_KEY is missing", async () => {
    delete process.env.SERVICE_ENCRYPTION_KEY;
    const { getEncryptionService } = await import("./encryption");
    expect(() => getEncryptionService()).toThrow(
      "Missing required SERVICE_ENCRYPTION_KEY",
    );
  });

  it("includes .env guidance in the error message", async () => {
    delete process.env.SERVICE_ENCRYPTION_KEY;
    const { getEncryptionService } = await import("./encryption");
    expect(() => getEncryptionService()).toThrow(
      "Set this in your .env file or environment.",
    );
  });

  it("throws when key format is invalid", async () => {
    process.env.SERVICE_ENCRYPTION_KEY = "not-hex-string";
    const { getEncryptionService } = await import("./encryption");
    expect(() => getEncryptionService()).toThrow("64-character hex string");
  });

  it("throws when key is too short", async () => {
    process.env.SERVICE_ENCRYPTION_KEY = "abc123";
    const { getEncryptionService } = await import("./encryption");
    expect(() => getEncryptionService()).toThrow("64-character hex string");
  });

  it("throws when key is empty", async () => {
    process.env.SERVICE_ENCRYPTION_KEY = "";
    const { getEncryptionService } = await import("./encryption");
    expect(() => getEncryptionService()).toThrow(
      "Missing required SERVICE_ENCRYPTION_KEY",
    );
  });

  it("returns a working encryption service", async () => {
    process.env.SERVICE_ENCRYPTION_KEY = VALID_KEY;
    const { getEncryptionService } = await import("./encryption");
    const service = getEncryptionService();

    expect(service).toBeDefined();
    expect(typeof service.encrypt).toBe("function");
    expect(typeof service.decrypt).toBe("function");
  });

  it("caches the instance across calls", async () => {
    process.env.SERVICE_ENCRYPTION_KEY = VALID_KEY;
    const { getEncryptionService } = await import("./encryption");

    const first = getEncryptionService();
    const second = getEncryptionService();
    expect(second).toBe(first);
  });

  it("service can encrypt and decrypt content", async () => {
    process.env.SERVICE_ENCRYPTION_KEY = VALID_KEY;
    const { getEncryptionService } = await import("./encryption");
    const { EncryptionAlgorithm } = await import("@uncefact/untp-ri-services/encryption");

    const service = getEncryptionService();
    const plaintext = '{"apiUrl":"https://example.com"}';
    const envelope = service.encrypt(plaintext, EncryptionAlgorithm.AES_256_GCM);
    const decrypted = service.decrypt(envelope);

    expect(decrypted).toBe(plaintext);
  });
});
