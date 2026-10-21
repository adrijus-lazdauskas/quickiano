// @vitest-environment node
import { Midi } from "@tonejs/midi";
import { describe, expect, it } from "vitest";
import { isMidi, parseMidi } from "../src/core/midi";
import type { Note } from "../src/core/types";

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

/**
 * One track with a key signature and quarter notes, written by hand: @tonejs/midi
 * writes key signatures wrong (index + 7), so its own writer can't make this file.
 */
function withKey(sharps: number, minor: boolean, notes: number[]): ArrayBuffer {
  const ev = [0x00, 0xff, 0x59, 0x02, sharps & 0xff, minor ? 1 : 0];
  for (const m of notes) ev.push(0x00, 0x90, m, 0x64, 0x83, 0x60, 0x80, m, 0x00);
  ev.push(0x00, 0xff, 0x2f, 0x00);
  const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0];
  return new Uint8Array([...head, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, ev.length, ...ev]).buffer;
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

  it("spells notes from the key signature, also in minor keys", () => {
    const name = (n: Note) => n.step + (n.alter > 0 ? "#" : n.alter < 0 ? "b" : "");
    const aMinor = parseMidi(withKey(0, true, [76, 75, 68]), "fur-elise.mid");
    expect(aMinor.fifths).toBe(0);
    expect(aMinor.mode).toBe("minor");
    expect(aMinor.notes.map(name)).toEqual(["E", "D#", "G#"]);
    const eMinor = parseMidi(withKey(1, true, [75]), "e.mid");
    expect(eMinor.fifths).toBe(1);
    expect(eMinor.notes.map(name)).toEqual(["D#"]);
    const cMinor = parseMidi(withKey(-3, true, [63, 68]), "c.mid");
    expect(cMinor.fifths).toBe(-3);
    expect(cMinor.notes.map(name)).toEqual(["Eb", "Ab"]);
  });

  it("rejects garbage", () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3]).buffer, "bad.mid")).toThrow(/could not be read/);
  });
});
