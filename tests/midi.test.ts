// @vitest-environment node
import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { isMidi, parseMidi } from "../src/core/midi";

function file(tracks: { midi: number; beat: number; beats: number }[][], ts: [number, number] = [4, 4]) {
  const m = new Midi();
  m.header.timeSignatures.push({ ticks: 0, timeSignature: ts });
  m.header.setTempo(90);
  for (const notes of tracks) {
    const t = m.addTrack();
    for (const n of notes)
      t.addNote({ midi: n.midi, ticks: n.beat * m.header.ppq, durationTicks: n.beats * m.header.ppq });
  }
  const u8 = m.toArray();
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) as ArrayBuffer;
}

describe("parseMidi", () => {
  it("maps the higher of two tracks to the right hand", () => {
    const buf = file([
      [
        { midi: 48, beat: 0, beats: 4 },
        { midi: 43, beat: 4, beats: 4 },
      ],
      [
        { midi: 64, beat: 0, beats: 1 },
        { midi: 65, beat: 1, beats: 1 },
        { midi: 67, beat: 4, beats: 2 },
      ],
    ]);
    expect(isMidi(new Uint8Array(buf))).toBe(true);
    const s = parseMidi(buf, "song.mid");
    expect(s.source).toBe("midi");
    expect(s.title).toBe("song");
    expect(s.notes.filter((n) => n.staff === 0).map((n) => n.midi)).toEqual([64, 65, 67]);
    expect(s.notes.filter((n) => n.staff === 1).map((n) => n.midi)).toEqual([48, 43]);
    expect(s.measures).toHaveLength(2);
    expect(s.notes.find((n) => n.midi === 67)!.m).toBe(1);
    expect(s.tempo).toBe(90);
  });

  it("splits a single track at middle C", () => {
    const buf = file([
      [
        { midi: 72, beat: 0, beats: 1 },
        { midi: 48, beat: 0, beats: 1 },
        { midi: 60, beat: 1, beats: 1 },
      ],
    ]);
    const s = parseMidi(buf, "x.mid");
    expect(
      s.notes
        .filter((n) => n.staff === 0)
        .map((n) => n.midi)
        .sort(),
    ).toEqual([60, 72]);
    expect(s.notes.filter((n) => n.staff === 1).map((n) => n.midi)).toEqual([48]);
  });

  it("builds bars from the time signature", () => {
    const buf = file([[{ midi: 60, beat: 0, beats: 9 }]], [3, 4]);
    const s = parseMidi(buf, "waltz.mid");
    expect(s.timeLabel).toBe("3/4");
    expect(s.measures.map((m) => m.startQ)).toEqual([0, 3, 6]);
  });

  it("rejects garbage", () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3]).buffer, "bad.mid")).toThrow(/could not be read/);
  });
});
