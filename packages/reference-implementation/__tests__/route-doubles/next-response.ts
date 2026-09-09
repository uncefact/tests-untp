export class MockNextResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;

  constructor(body: unknown, init?: { status?: number; headers?: HeadersInit }) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.headers = new Headers(init?.headers);
  }

  async json(): Promise<unknown> {
    return this.body;
  }

  async text(): Promise<string> {
    if (this.body === null) return '';
    return typeof this.body === 'string' ? this.body : JSON.stringify(this.body);
  }

  static json(body: unknown, init?: { status?: number; headers?: HeadersInit }): MockNextResponse {
    return new MockNextResponse(body, init);
  }
}
