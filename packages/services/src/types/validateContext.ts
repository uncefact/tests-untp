export interface IValidateContext {
  (context: any): boolean;
}

export type Result<T> = { ok: true; value: T } | { ok: false; value: string };
