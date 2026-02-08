// Mock next/server before importing route handlers
jest.mock("next/server", () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

// Mock withOrgAuth as passthrough
jest.mock("@/lib/api/with-org-auth", () => ({
  withOrgAuth: (handler: (...args: unknown[]) => unknown) => handler,
}));

const mockResolveDidService = jest.fn();
const mockCreateDid = jest.fn();
const mockListDids = jest.fn();

jest.mock("@/lib/services/resolve-did-service", () => ({
  resolveDidService: (...args: unknown[]) => mockResolveDidService(...args),
}));

jest.mock("@/lib/prisma/repositories", () => ({
  createDid: (input: unknown) => mockCreateDid(input),
  listDids: (orgId: string, opts: unknown) => mockListDids(orgId, opts),
}));

import { ServiceResolutionError } from "@/lib/api/errors";
import { DidType, DidMethod, DidStatus } from "@mock-app/services";
import { POST, GET } from "./route";

function createFakeRequest(options: {
  method?: string;
  body?: unknown;
  url?: string;
  rawBody?: string;
}): Request {
  const { method = "POST", body, url = "http://localhost/api/v1/dids", rawBody } = options;
  const bodyString = rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined);
  return {
    method,
    url,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: bodyString !== undefined
      ? async () => JSON.parse(bodyString)
      : async () => { throw new SyntaxError("Unexpected token"); },
  } as unknown as Request;
}

function createBadJsonRequest(): Request {
  return {
    method: "POST",
    url: "http://localhost/api/v1/dids",
    headers: new Headers({ "Content-Type": "application/json" }),
    json: async () => { throw new SyntaxError("Unexpected token n in JSON at position 0"); },
  } as unknown as Request;
}

const AUTH_CONTEXT = { organizationId: "org-1", params: Promise.resolve({}) };

describe("POST /api/v1/dids", () => {
  const mockDidService = {
    create: jest.fn(),
    normaliseAlias: jest.fn().mockImplementation((alias: string) => alias),
    getSupportedTypes: jest.fn().mockReturnValue(["MANAGED", "SELF_MANAGED"]),
    getSupportedMethods: jest.fn().mockReturnValue(["DID_WEB"]),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveDidService.mockResolvedValue({ service: mockDidService, instanceId: "inst-1" });
  });

  it("creates a managed DID and returns 201", async () => {
    mockDidService.create.mockResolvedValue({
      did: "did:web:example.com:org:123",
      keyId: "key-1",
      document: { "@context": "https://www.w3.org/ns/did/v1", id: "did:web:example.com:org:123" },
    });
    mockCreateDid.mockResolvedValue({
      id: "record-1",
      did: "did:web:example.com:org:123",
      type: DidType.MANAGED,
      status: DidStatus.ACTIVE,
    });

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: "my-did", name: "My DID" },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.did.did).toBe("did:web:example.com:org:123");
  });

  it("creates a self-managed DID with UNVERIFIED status and serviceInstanceId", async () => {
    mockDidService.create.mockResolvedValue({
      did: "did:web:example.com:org:456",
      keyId: "key-2",
      document: { "@context": "https://www.w3.org/ns/did/v1", id: "did:web:example.com:org:456" },
    });
    mockCreateDid.mockResolvedValue({
      id: "record-2",
      status: DidStatus.UNVERIFIED,
    });

    const req = createFakeRequest({
      body: { type: DidType.SELF_MANAGED, method: DidMethod.DID_WEB, alias: "self-managed" },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(201);
    expect(mockCreateDid).toHaveBeenCalledWith(
      expect.objectContaining({ status: DidStatus.UNVERIFIED, serviceInstanceId: "inst-1" }),
    );
  });

  it("returns 400 for invalid type", async () => {
    const req = createFakeRequest({
      body: { type: "INVALID", method: DidMethod.DID_WEB },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("type must be");
  });

  it("returns 400 for missing type", async () => {
    const req = createFakeRequest({ body: { method: DidMethod.DID_WEB } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid method", async () => {
    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: "INVALID" },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("method must be");
  });

  it("returns 400 for missing method", async () => {
    const req = createFakeRequest({ body: { type: DidType.MANAGED } });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("method is required");
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = createBadJsonRequest();
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid JSON body");
  });

  it("returns 500 when DID service fails", async () => {
    mockDidService.create.mockRejectedValue(new Error("VCKit error"));

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: "test" },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("VCKit error");
  });

  it("passes correct options to didService.create", async () => {
    mockDidService.create.mockResolvedValue({
      did: "did:web:example.com",
      keyId: "key-1",
      document: { "@context": "https://www.w3.org/ns/did/v1", id: "did:web:example.com" },
    });
    mockCreateDid.mockResolvedValue({ id: "record-1" });

    const req = createFakeRequest({
      body: {
        type: DidType.MANAGED,
        method: DidMethod.DID_WEB,
        alias: "test-org",
        name: "Test",
        description: "A test DID",
      },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockDidService.create).toHaveBeenCalledWith({
      type: DidType.MANAGED,
      method: DidMethod.DID_WEB,
      alias: "test-org",
      name: "Test",
      description: "A test DID",
    });
  });

  it("returns 500 when service resolution fails", async () => {
    mockResolveDidService.mockRejectedValue(
      new ServiceResolutionError("DID", "org-1"),
    );

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: "test" },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain("No service instance available");
  });

  it("returns 400 when service does not support the requested type", async () => {
    mockDidService.getSupportedTypes.mockReturnValue(["MANAGED"]);

    const req = createFakeRequest({
      body: { type: DidType.SELF_MANAGED, method: DidMethod.DID_WEB, alias: "test" },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("type must be one of");
  });

  it("returns 400 when alias normalisation fails", async () => {
    mockDidService.normaliseAlias.mockImplementation(() => {
      throw new Error('Invalid DID alias: "!!!" produces an empty identifier after normalisation');
    });

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: "!!!" },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Invalid DID alias");
  });

  it("passes the normalised alias to didService.create", async () => {
    mockDidService.normaliseAlias.mockReturnValue("my-normalised-alias");
    mockDidService.create.mockResolvedValue({
      did: "did:web:example.com:my-normalised-alias",
      keyId: "key-1",
      document: { "@context": "https://www.w3.org/ns/did/v1", id: "did:web:example.com:my-normalised-alias" },
    });
    mockCreateDid.mockResolvedValue({ id: "record-1" });

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: "My Normalised Alias" },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockDidService.normaliseAlias).toHaveBeenCalledWith("My Normalised Alias", DidMethod.DID_WEB);
    expect(mockDidService.create).toHaveBeenCalledWith(
      expect.objectContaining({ alias: "my-normalised-alias" }),
    );
  });

  it("returns 400 when service does not support the requested method", async () => {
    mockDidService.getSupportedMethods.mockReturnValue(["DID_WEB"]);

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB_VH, alias: "test" },
    });
    const res = await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("method must be one of");
  });

  it("resolves the DID service with the organisation ID", async () => {
    mockDidService.create.mockResolvedValue({
      did: "did:web:example.com",
      keyId: "key-1",
      document: { "@context": "https://www.w3.org/ns/did/v1", id: "did:web:example.com" },
    });
    mockCreateDid.mockResolvedValue({ id: "record-1" });

    const req = createFakeRequest({
      body: { type: DidType.MANAGED, method: DidMethod.DID_WEB, alias: "test" },
    });
    await POST(req, AUTH_CONTEXT as unknown as Parameters<typeof POST>[1]);

    expect(mockResolveDidService).toHaveBeenCalledWith("org-1", undefined);
  });
});

describe("GET /api/v1/dids", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lists DIDs for the organisation", async () => {
    const dids = [{ id: "1", did: "did:web:example.com" }];
    mockListDids.mockResolvedValue(dids);

    const req = createFakeRequest({ method: "GET", url: "http://localhost/api/v1/dids" });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.dids).toEqual(dids);
  });

  it("passes query parameters to listDids", async () => {
    mockListDids.mockResolvedValue([]);

    const req = createFakeRequest({
      method: "GET",
      url: "http://localhost/api/v1/dids?type=MANAGED&status=ACTIVE&serviceInstanceId=inst-1&limit=10&offset=5",
    });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDids).toHaveBeenCalledWith("org-1", {
      type: "MANAGED",
      status: "ACTIVE",
      serviceInstanceId: "inst-1",
      limit: 10,
      offset: 5,
    });
  });

  it("handles no query parameters", async () => {
    mockListDids.mockResolvedValue([]);

    const req = createFakeRequest({ method: "GET", url: "http://localhost/api/v1/dids" });
    await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(mockListDids).toHaveBeenCalledWith("org-1", {
      type: undefined,
      status: undefined,
      serviceInstanceId: undefined,
      limit: undefined,
      offset: undefined,
    });
  });

  it("returns 400 for invalid type query parameter", async () => {
    const req = createFakeRequest({
      method: "GET",
      url: "http://localhost/api/v1/dids?type=GARBAGE",
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("type must be");
  });

  it("returns 400 for invalid status query parameter", async () => {
    const req = createFakeRequest({
      method: "GET",
      url: "http://localhost/api/v1/dids?status=GARBAGE",
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("status must be");
  });

  it("returns 400 for non-numeric limit", async () => {
    const req = createFakeRequest({
      method: "GET",
      url: "http://localhost/api/v1/dids?limit=abc",
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("limit must be a positive integer");
  });

  it("returns 400 for negative offset", async () => {
    const req = createFakeRequest({
      method: "GET",
      url: "http://localhost/api/v1/dids?offset=-1",
    });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("offset must be a non-negative integer");
  });

  it("returns 500 when listDids throws", async () => {
    mockListDids.mockRejectedValue(new Error("Database error"));

    const req = createFakeRequest({ method: "GET", url: "http://localhost/api/v1/dids" });
    const res = await GET(req, AUTH_CONTEXT as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain("Database error");
  });
});
