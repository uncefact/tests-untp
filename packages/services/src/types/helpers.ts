type JSONPrimitive = string | number | boolean | null;

export type JSONValue = JSONPrimitive | JSONObject | JSONArray;

export interface JSONObject {
  [key: string]: JSONValue;
}

export type JSONArray = Array<JSONValue>;

export type Extensible = { [key: string]: JSONValue | undefined };
export type NonEmptyArray<T> = [T, ...T[]];
export type OneOrMany<T> = T | NonEmptyArray<T>;
