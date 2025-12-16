type JSONPrimitive = string | number | boolean | null;

export type JSONValue = JSONPrimitive | JSONObject | JSONArray;

export interface JSONObject {
    [x: string]: JSONValue;
}

export interface JSONArray extends Array<JSONValue> { }

export type Extensible = { [key: string]: JSONValue | undefined };
