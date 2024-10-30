export interface IComponentFunc {
  onChange: ({ data, errors }: { data: any; errors?: any[] }) => void;
}

export enum ImportDataType {
  VerifiableCredential = 'VerifiableCredential',
  JSON = 'JSON',
}

export interface IVCContext {
  vckitAPIUrl?: string;
  headers?: Record<string, string>;
}
