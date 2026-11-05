// AudioWorkletGlobalScope has no TextDecoder/TextEncoder, but the DeepFilterNet wasm glue creates both when it
// loads (it only uses them for panic messages). Import this first. Minimal UTF-8, enough for that.
const g = globalThis as unknown as Record<string, unknown>;
if (typeof g.TextDecoder === "undefined") {
  g.TextDecoder = class {
    decode(bytes?: Uint8Array): string {
      if (!bytes) return "";
      let s = "";
      for (let i = 0; i < bytes.length; ) {
        const b = bytes[i++]!;
        let cp = b;
        if (b >= 0xf0) cp = ((b & 7) << 18) | ((bytes[i++]! & 63) << 12) | ((bytes[i++]! & 63) << 6) | (bytes[i++]! & 63);
        else if (b >= 0xe0) cp = ((b & 15) << 12) | ((bytes[i++]! & 63) << 6) | (bytes[i++]! & 63);
        else if (b >= 0xc0) cp = ((b & 31) << 6) | (bytes[i++]! & 63);
        s += String.fromCodePoint(cp);
      }
      return s;
    }
  };
}
if (typeof g.TextEncoder === "undefined") {
  g.TextEncoder = class {
    encode(str = ""): Uint8Array {
      const out: number[] = [];
      for (const ch of str) {
        const c = ch.codePointAt(0)!;
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
      return new Uint8Array(out);
    }
    encodeInto(str: string, dst: Uint8Array) {
      const b = this.encode(str);
      const n = Math.min(b.length, dst.length);
      dst.set(b.subarray(0, n));
      return { read: str.length, written: n };
    }
  };
}
export {};
