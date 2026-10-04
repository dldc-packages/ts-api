import JsonURL from "@jsonurl/jsonurl";

/**
 * The CJS build of `@jsonurl/jsonurl` exposes `stringify` and `parse` on the
 * default export, but its shipped type declarations type the default import as
 * the module namespace, so those members are hidden from the type system. Cast
 * once here so the calls below type-check.
 */
type TJsonURL = {
  stringify(value: any, options?: object): string | undefined;
  parse(text: string, options?: object): any;
};

const jsonurl = JsonURL as unknown as TJsonURL;

const options: object = {
  AQF: true,
  noEmptyComposite: true,
};

export function stringifyJsonURL(obj: any): string | undefined {
  return jsonurl.stringify(obj, options);
}

export function parseJsonURL(str: string): any {
  return jsonurl.parse(str, options);
}

export function encodePath(path: string[]): string {
  return path.map(encodeURIComponent).join(".");
}

export function decodePath(encodedPath: string): string[] {
  return encodedPath.split(".").map(decodeURIComponent);
}
