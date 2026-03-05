import { NextResponse } from 'next/server';

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    })),
  },
}));

import { GET } from './route';

describe('GET /api/health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns healthy with 200', () => {
    GET();

    expect(NextResponse.json).toHaveBeenCalledWith(expect.objectContaining({ status: 'healthy' }));
  });

  it('includes a timestamp', () => {
    GET();

    const call = (NextResponse.json as jest.Mock).mock.calls[0][0];
    expect(call.timestamp).toBeDefined();
    expect(() => new Date(call.timestamp)).not.toThrow();
  });
});
