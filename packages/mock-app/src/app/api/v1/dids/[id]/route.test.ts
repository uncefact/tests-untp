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

const mockGetDidById = jest.fn();
const mockUpdateDid = jest.fn();

jest.mock("@/lib/prisma/repositories", () => ({
  getDidById: (id: string, orgId: string) => mockGetDidById(id, orgId),
  updateDid: (id: string, orgId: string, input: unknown) => mockUpdateDid(id, orgId, input),
}));

import { NotFoundError } from "@/lib/api/errors";
import { GET, PUT } from "./route";

function createFakeRequest(options: {
  method?: string;
  body?: unknown;
  url?: string;
}): Request {
  const { method = "GET", body, url = "http://localhost/api/v1/dids/did-1" } = options;
  const bodyString = body !== undefined ? JSON.stringify(body) : undefined;
  return {
    method,
    url,
    headers: new Headers({ "Content-Type": "application/json" }),
    json: bodyString !== undefined
      ? async () => JSON.parse(bodyString)
      : async () => { throw new SyntaxError("Unexpected token"); },
  } as unknown as Request;
}

function createContext(id: string) {
  return { organizationId: "org-1", params: Promise.resolve({ id }) };
}

describe("GET /api/v1/dids/:id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns the DID record", async () => {
    const did = { id: "did-1", did: "did:web:example.com", type: "MANAGED" };
    mockGetDidById.mockResolvedValue(did);

    const req = createFakeRequest({});
    const res = await GET(req, createContext("did-1") as unknown as Parameters<typeof GET>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.did).toEqual(did);
  });

  it("returns 404 when DID not found", async () => {
    mockGetDidById.mockResolvedValue(null);

    const req = createFakeRequest({});
    const res = await GET(req, createContext("nonexistent") as unknown as Parameters<typeof GET>[1]);

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/v1/dids/:id", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("updates name and description", async () => {
    const updated = { id: "did-1", name: "New Name", description: "New desc" };
    mockUpdateDid.mockResolvedValue(updated);

    const req = createFakeRequest({ method: "PUT", body: { name: "New Name", description: "New desc" } });
    const res = await PUT(req, createContext("did-1") as unknown as Parameters<typeof PUT>[1]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.did.name).toBe("New Name");
  });

  it("returns 400 when no fields provided", async () => {
    const req = createFakeRequest({ method: "PUT", body: {} });
    const res = await PUT(req, createContext("did-1") as unknown as Parameters<typeof PUT>[1]);

    expect(res.status).toBe(400);
  });

  it("returns 404 when DID not found or access denied", async () => {
    mockUpdateDid.mockRejectedValue(new NotFoundError("DID not found or access denied"));

    const req = createFakeRequest({ method: "PUT", body: { name: "New Name" } });
    const res = await PUT(req, createContext("did-1") as unknown as Parameters<typeof PUT>[1]);

    expect(res.status).toBe(404);
  });
});
