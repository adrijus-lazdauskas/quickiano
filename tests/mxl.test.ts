// @vitest-environment node
import { describe, expect, it } from "vitest";
import { bytesToScoreText, hashText } from "../src/core/mxl";

const enc = new TextEncoder();

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Builds a zip with the given entries; method 8 entries are deflated. */
async function zip(files: { name: string; text: string; deflate: boolean }[]): Promise<ArrayBuffer> {
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const raw = enc.encode(f.text);
    const data = f.deflate ? await deflateRaw(raw) : raw;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(8, f.deflate ? 8 : 0, true);
    lh.setUint32(18, data.length, true);
    lh.setUint32(22, raw.length, true);
    lh.setUint16(26, name.length, true);
    local.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(10, f.deflate ? 8 : 0, true);
    ch.setUint32(20, data.length, true);
    ch.setUint32(24, raw.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out.buffer;
}

describe("bytesToScoreText", () => {
  it("passes plain MusicXML through and strips a BOM", async () => {
    const text = await bytesToScoreText(enc.encode("\uFEFF<score-partwise/>").buffer as ArrayBuffer);
    expect(text).toBe("<score-partwise/>");
  });

  it("follows container.xml in a deflated .mxl", async () => {
    const buf = await zip([
      {
        name: "META-INF/container.xml",
        text: '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>',
        deflate: false,
      },
      { name: "score.musicxml", text: "<score-partwise>hello</score-partwise>", deflate: true },
    ]);
    expect(await bytesToScoreText(buf)).toBe("<score-partwise>hello</score-partwise>");
  });

  it("finds the score without a container file", async () => {
    const buf = await zip([{ name: "piece.xml", text: "<score-partwise/>", deflate: false }]);
    expect(await bytesToScoreText(buf)).toBe("<score-partwise/>");
  });
});

describe("hashText", () => {
  it("is stable and differs for different input", () => {
    expect(hashText("abc")).toBe(hashText("abc"));
    expect(hashText("abc")).not.toBe(hashText("abd"));
  });
});
