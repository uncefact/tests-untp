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

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns a healthy status and the current timestamp', () => {
    const mockDate = new Date('2024-01-01T00:00:00.000Z');
    jest.useFakeTimers().setSystemTime(mockDate);

    GET();

    expect(NextResponse.json).toHaveBeenCalledWith({
      status: 'healthy',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
  });
});
