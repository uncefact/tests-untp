export interface TestSuiteHandler {
  (options: any): Promise<void>;
}

export interface CreateConfigHandler {
  (): Promise<void>
}