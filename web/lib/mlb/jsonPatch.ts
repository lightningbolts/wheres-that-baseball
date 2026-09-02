/** RFC 6902 JSON Patch (add / remove / replace / move / copy / test). */

export interface JsonPatchOp {
  op: "add" | "remove" | "replace" | "move" | "copy" | "test";
  path: string;
  from?: string;
  value?: unknown;
}

export class JsonPatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonPatchError";
  }
}

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function unescapePointerToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function parsePointer(path: string): string[] {
  if (path === "") return [];
  if (!path.startsWith("/")) {
    throw new JsonPatchError(`JSON Pointer must start with '/': ${path}`);
  }
  return path.split("/").slice(1).map(unescapePointerToken);
}

function isIndexToken(token: string, arr: unknown[]): boolean {
  if (token === "-") return true;
  if (!/^(0|[1-9]\d*)$/.test(token)) return false;
  const index = Number(token);
  return index >= 0 && index <= arr.length;
}

interface Cursor {
  parent: Record<string, unknown> | unknown[];
  key: string;
}

function walk(doc: unknown, tokens: string[], throughLast: boolean): unknown {
  let current: unknown = doc;
  const end = throughLast ? tokens.length : tokens.length - 1;
  for (let i = 0; i < end; i += 1) {
    const token = tokens[i]!;
    if (current == null || typeof current !== "object") {
      throw new JsonPatchError(`Cannot walk ${tokens.slice(0, i + 1).join("/")}`);
    }
    if (Array.isArray(current)) {
      if (!isIndexToken(token, current) || token === "-") {
        throw new JsonPatchError(`Invalid array index ${token}`);
      }
      current = current[Number(token)];
    } else {
      current = (current as Record<string, unknown>)[token];
    }
  }
  return current;
}

function cursorAt(doc: unknown, path: string): Cursor {
  const tokens = parsePointer(path);
  if (tokens.length === 0) {
    throw new JsonPatchError("Cannot target document root");
  }
  const parent = walk(doc, tokens, false);
  const key = tokens[tokens.length - 1]!;
  if (parent == null || typeof parent !== "object") {
    throw new JsonPatchError(`Missing parent for ${path}`);
  }
  return { parent: parent as Record<string, unknown> | unknown[], key };
}

function readAt(doc: unknown, path: string): unknown {
  const tokens = parsePointer(path);
  if (tokens.length === 0) return doc;
  const { parent, key } = cursorAt(doc, path);
  if (Array.isArray(parent)) {
    if (!isIndexToken(key, parent) || key === "-") {
      throw new JsonPatchError(`Invalid array index ${key}`);
    }
    const index = Number(key);
    if (index >= parent.length) {
      throw new JsonPatchError(`Array index out of range: ${path}`);
    }
    return parent[index];
  }
  if (!(key in parent)) {
    throw new JsonPatchError(`Missing key ${path}`);
  }
  return parent[key];
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every((key) =>
      deepEqual(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
      ),
    );
  }
  return false;
}

function addAt(parent: Record<string, unknown> | unknown[], key: string, value: unknown): void {
  if (Array.isArray(parent)) {
    if (key === "-") {
      parent.push(value);
      return;
    }
    if (!isIndexToken(key, parent)) {
      throw new JsonPatchError(`Invalid array index ${key}`);
    }
    const index = Number(key);
    if (index > parent.length) {
      throw new JsonPatchError(`Array index out of range: ${key}`);
    }
    parent.splice(index, 0, value);
    return;
  }
  parent[key] = value;
}

function removeAt(parent: Record<string, unknown> | unknown[], key: string): unknown {
  if (Array.isArray(parent)) {
    if (!isIndexToken(key, parent) || key === "-") {
      throw new JsonPatchError(`Invalid array index ${key}`);
    }
    const index = Number(key);
    if (index >= parent.length) {
      throw new JsonPatchError(`Array index out of range: ${key}`);
    }
    const [removed] = parent.splice(index, 1);
    return removed;
  }
  if (!(key in parent)) {
    throw new JsonPatchError(`Missing key ${key}`);
  }
  const removed = parent[key];
  delete parent[key];
  return removed;
}

function replaceAt(parent: Record<string, unknown> | unknown[], key: string, value: unknown): void {
  if (Array.isArray(parent)) {
    if (!isIndexToken(key, parent) || key === "-") {
      throw new JsonPatchError(`Invalid array index ${key}`);
    }
    const index = Number(key);
    if (index >= parent.length) {
      throw new JsonPatchError(`Array index out of range: ${key}`);
    }
    parent[index] = value;
    return;
  }
  if (!(key in parent)) {
    throw new JsonPatchError(`Missing key ${key}`);
  }
  parent[key] = value;
}

function applyOp(doc: unknown, op: JsonPatchOp): void {
  switch (op.op) {
    case "add": {
      const { parent, key } = cursorAt(doc, op.path);
      addAt(parent, key, cloneJson(op.value));
      return;
    }
    case "remove": {
      const { parent, key } = cursorAt(doc, op.path);
      removeAt(parent, key);
      return;
    }
    case "replace": {
      const { parent, key } = cursorAt(doc, op.path);
      replaceAt(parent, key, cloneJson(op.value));
      return;
    }
    case "move": {
      if (!op.from) throw new JsonPatchError("move requires from");
      const fromCur = cursorAt(doc, op.from);
      const moving = removeAt(fromCur.parent, fromCur.key);
      const toCur = cursorAt(doc, op.path);
      addAt(toCur.parent, toCur.key, moving);
      return;
    }
    case "copy": {
      if (!op.from) throw new JsonPatchError("copy requires from");
      const copied = cloneJson(readAt(doc, op.from));
      const { parent, key } = cursorAt(doc, op.path);
      addAt(parent, key, copied);
      return;
    }
    case "test": {
      if (!deepEqual(readAt(doc, op.path), op.value)) {
        throw new JsonPatchError(`test failed at ${op.path}`);
      }
      return;
    }
    default:
      throw new JsonPatchError(`Unsupported op ${(op as JsonPatchOp).op}`);
  }
}

/** Apply RFC 6902 ops to a clone of `document`. Throws JsonPatchError on failure. */
export function applyJsonPatch<T>(document: T, ops: JsonPatchOp[]): T {
  const next = cloneJson(document);
  for (const op of ops) {
    applyOp(next, op);
  }
  return next;
}

function isPatchOp(value: unknown): value is JsonPatchOp {
  if (!value || typeof value !== "object") return false;
  const op = (value as JsonPatchOp).op;
  return (
    op === "add" ||
    op === "remove" ||
    op === "replace" ||
    op === "move" ||
    op === "copy" ||
    op === "test"
  );
}

function opsFromUnknown(value: unknown): JsonPatchOp[] | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    if (value.every(isPatchOp)) return value;
    const nested: JsonPatchOp[] = [];
    for (const item of value) {
      if (item && typeof item === "object" && Array.isArray((item as { diff?: unknown }).diff)) {
        const inner = opsFromUnknown((item as { diff: unknown }).diff);
        if (!inner) return null;
        nested.push(...inner);
        continue;
      }
      return null;
    }
    return nested;
  }
  if (value && typeof value === "object" && Array.isArray((value as { diff?: unknown }).diff)) {
    return opsFromUnknown((value as { diff: unknown }).diff);
  }
  return null;
}

export function isMlbFullLiveFeed(
  body: unknown,
): body is { gameData: unknown; liveData: unknown } {
  return Boolean(
    body &&
      typeof body === "object" &&
      "gameData" in body &&
      "liveData" in body,
  );
}

/** MLB diffPatch is either RFC 6902 ops (sometimes wrapped in `{diff: [...]}`) or a full GUMBO. */
export type MlbDiffPatchParse =
  | { kind: "ops"; ops: JsonPatchOp[] }
  | { kind: "full" }
  | { kind: "empty" };

export function parseMlbDiffPatchBody(body: unknown): MlbDiffPatchParse {
  if (body == null) return { kind: "empty" };
  if (Array.isArray(body) && body.length === 0) return { kind: "empty" };
  const ops = opsFromUnknown(body);
  if (ops) {
    return ops.length === 0 ? { kind: "empty" } : { kind: "ops", ops };
  }
  if (isMlbFullLiveFeed(body)) return { kind: "full" };
  return { kind: "empty" };
}
