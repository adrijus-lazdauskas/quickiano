/** Reads .musicxml, .xml and compressed .mxl files into MusicXML text. */

export function decodeText(u8: Uint8Array): string {
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder("utf-16le").decode(u8);
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder("utf-16be").decode(u8);
  return new TextDecoder("utf-8").decode(u8).replace(/^﻿/, "");
}

export function isZip(u8: Uint8Array): boolean {
  return u8[0] === 0x50 && u8[1] === 0x4b;
}

export async function bytesToScoreText(buf: ArrayBuffer): Promise<string> {
  const u8 = new Uint8Array(buf);
  return isZip(u8) ? unzipMusicXML(buf) : decodeText(u8);
}

interface ZipEntry {
  method: number;
  csize: number;
  offset: number;
}

/** Minimal zip reader: enough for compressed MusicXML (stored or deflate entries). */
export async function unzipMusicXML(buf: ArrayBuffer): Promise<string> {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("The .mxl file is damaged.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder("utf-8");
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const xlen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    entries.set(utf8.decode(u8.subarray(p + 46, p + 46 + nlen)), { method, csize, offset });
    p += 46 + nlen + xlen + clen;
  }

  async function read(name: string): Promise<string> {
    const e = entries.get(name);
    if (!e) throw new Error("The .mxl file is damaged.");
    const l = e.offset;
    const start = l + 30 + dv.getUint16(l + 26, true) + dv.getUint16(l + 28, true);
    const data = u8.slice(start, start + e.csize);
    if (e.method === 0) return decodeText(data);
    if (e.method !== 8 || typeof DecompressionStream === "undefined") {
      throw new Error(
        "Your browser can't unpack this .mxl file. Export it as uncompressed MusicXML instead.",
      );
    }
    const stream = new Response(data).body!.pipeThrough(new DecompressionStream("deflate-raw"));
    return decodeText(new Uint8Array(await new Response(stream).arrayBuffer()));
  }

  let rootFile: string | undefined;
  if (entries.has("META-INF/container.xml")) {
    const m = (await read("META-INF/container.xml")).match(/full-path="([^"]+)"/);
    if (m && entries.has(m[1])) rootFile = m[1];
  }
  if (!rootFile) {
    rootFile = [...entries.keys()].find((n) => !n.startsWith("META-INF") && /\.(musicxml|xml)$/i.test(n));
  }
  if (!rootFile) throw new Error("There is no score inside this .mxl file.");
  return read(rootFile);
}

/** FNV-1a hash plus length: a short, stable key for saved settings per song. */
export function hashText(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + s.length.toString(36);
}

export function hashBytes(u8: Uint8Array): string {
  let h = 2166136261;
  for (let i = 0; i < u8.length; i++) {
    h ^= u8[i];
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + u8.length.toString(36);
}
