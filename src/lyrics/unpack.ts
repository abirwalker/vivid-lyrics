type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

// SLObjPack wire format: a primitive dictionary and an opcode stream.
// Protocol reference: https://github.com/Spikerko/spicy-lyrics/blob/main/src/utils/objpack.ts
export function unpackLyrics(payload: unknown): unknown {
  if (!Array.isArray(payload)) return payload;
  if (payload.length !== 2 || !Array.isArray(payload[0]) || !Array.isArray(payload[1])) {
    throw new Error("Invalid packed lyrics payload");
  }
  const [values, stream] = payload;
  if (values.length > 2 ** 22 || stream.length > 2 ** 24) {
    throw new Error("Packed lyrics exceed size limits");
  }
  for (const value of values) {
    if (value === null || typeof value === "string" || typeof value === "boolean") continue;
    if (typeof value === "number" && Number.isFinite(value)) continue;
    throw new Error("Invalid packed lyrics dictionary value");
  }

  let cursor = 0;
  let remainingNodes = 2 ** 22;
  function read(): number {
    if (cursor >= stream.length || !Number.isSafeInteger(stream[cursor])) {
      throw new Error("Invalid or truncated packed lyrics stream");
    }
    return stream[cursor++];
  }
  function count(max: number): number {
    const size = read();
    if (size < 0 || size > max) throw new Error("Invalid packed lyrics count");
    return size;
  }
  function valueAt(index: number): JsonValue {
    if (index < 0 || index >= values.length) throw new Error("Invalid packed lyrics reference");
    return values[index];
  }
  function keys(size: number): string[] {
    return Array.from({ length: size }, () => {
      const key = valueAt(read());
      if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) {
        throw new Error("Invalid packed lyrics object key");
      }
      return key;
    });
  }
  function requireEntries(size: number): void {
    if (size > stream.length - cursor) throw new Error("Truncated packed lyrics structure");
  }
  function object(fields: string[], depth: number): JsonValue {
    return Object.fromEntries(fields.map(key => [key, decode(depth + 1)]));
  }
  function decode(depth: number): JsonValue {
    if (depth > 512 || --remainingNodes < 0) throw new Error("Packed lyrics exceed decode limits");
    const op = read();
    if (op >= 0) return valueAt(op);
    switch (op) {
      case -1: {
        const size = count(2 ** 16);
        requireEntries(size * 2);
        return object(keys(size), depth);
      }
      case -2: {
        const size = count(2 ** 20);
        requireEntries(size);
        return Array.from({ length: size }, () => decode(depth + 1));
      }
      case -3: {
        const size = count(2 ** 20);
        const fieldCount = count(2 ** 16);
        if (size * (fieldCount + 1) > remainingNodes) throw new Error("Packed lyrics exceed decode limits");
        requireEntries(fieldCount + size * fieldCount);
        const fields = keys(fieldCount);
        remainingNodes -= size;
        return Array.from({ length: size }, () => object(fields, depth));
      }
      case -4: return [];
      case -5: return [decode(depth + 1)];
      case -6: return {};
      default: throw new Error(`Unknown packed lyrics opcode: ${op}`);
    }
  }

  const decoded = decode(0);
  if (cursor !== stream.length) throw new Error("Extra data in packed lyrics stream");
  return decoded;
}
