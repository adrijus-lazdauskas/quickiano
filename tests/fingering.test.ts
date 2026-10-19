import { describe, expect, it } from "vitest";
import { computeFingering } from "../src/core/fingering";
import { parseMusicXML } from "../src/core/musicxml";
import { backup, note, pianoXML } from "./helpers";

const CMAJ = ["C4", "D4", "E4", "F4", "G4", "A4", "B4", "C5"];
const CMAJ_LH = ["C3", "D3", "E3", "F3", "G3", "A3", "B3", "C4"];

function scale(rh: string[], lh: string[]) {
  const bar = (r: string[], l: string[], n: number) =>
    `<measure number="${n}">` +
    r.map((p) => note(p, 4, 1)).join("") +
    backup(16) +
    l.map((p) => note(p, 4, 2)).join("") +
    "</measure>";
  return parseMusicXML(pianoXML(bar(rh.slice(0, 4), lh.slice(0, 4), 1) + bar(rh.slice(4), lh.slice(4), 2)));
}

describe("computeFingering", () => {
  it("fingers a C major scale in the right hand with a thumb under", () => {
    const s = scale(CMAJ, CMAJ_LH);
    computeFingering(s);
    const rh = s.notes.filter((n) => n.staff === 0).map((n) => n.finger);
    expect(rh).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });

  it("fingers a rising left-hand scale with crossings only over the thumb", () => {
    const s = scale(CMAJ, CMAJ_LH);
    computeFingering(s);
    const lh = s.notes.filter((n) => n.staff === 1).map((n) => n.finger!);
    expect(lh.at(-1)).toBe(1);
    for (let i = 1; i < lh.length; i++) {
      expect(lh[i]).not.toBe(lh[i - 1]);
      // going up with the left hand the fingers count down, except right after the thumb
      if (lh[i] > lh[i - 1]) expect(lh[i - 1]).toBe(1);
    }
  });

  it("lets your own finger win and marks the source", () => {
    const s = scale(CMAJ, CMAJ_LH);
    const first = s.notes.find((n) => n.staff === 0)!;
    computeFingering(s, { [first.id]: 2 });
    expect(first.finger).toBe(2);
    expect(first.fingerSrc).toBe("user");
    const second = s.notes.filter((n) => n.staff === 0)[1];
    expect(second.fingerSrc).toBe("auto");
  });

  it("uses fingerings written in the file", () => {
    const xml = pianoXML(
      '<measure number="1">' +
        note("E4", 4, 1, { finger: 2 }) +
        note("F4", 4, 1) +
        note("G4", 8, 1) +
        backup(16) +
        note("C3", 16, 2) +
        "</measure>",
    );
    const s = parseMusicXML(xml);
    computeFingering(s);
    const rh = s.notes.filter((n) => n.staff === 0);
    expect(rh[0].finger).toBe(2);
    expect(rh[0].fingerSrc).toBe("file");
    expect(rh[1].fingerSrc).toBe("auto");
    expect(rh[1].finger).not.toBe(2);
  });

  it("gives every chord tone its own finger", () => {
    const xml = pianoXML(
      '<measure number="1">' +
        note("C4", 16, 1) +
        note("E4", 16, 1, { chord: true }) +
        note("G4", 16, 1, { chord: true }) +
        backup(16) +
        note("C3", 16, 2) +
        "</measure>",
    );
    const s = parseMusicXML(xml);
    computeFingering(s);
    const fs = s.notes.filter((n) => n.staff === 0).map((n) => n.finger);
    expect(new Set(fs).size).toBe(3);
    expect(fs).toEqual([1, 3, 5]);
  });
});
