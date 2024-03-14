export interface TestSuiteHandler {
  (options: any): Promise<void>;
}

export interface GenerateCredentialFileHandler {
  (storePath: string, schemasPath: string): Promise<void>
}