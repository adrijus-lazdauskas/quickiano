import { describe, expect, it } from "vitest";
import { fullName, keyName, pitchName, spellMidi } from "../src/core/noteNames";

describe("pitchName", () => {
  it("uses B in english and H in german", () => {
    expect(pitchName("B", 0, "english")).toBe("B");
    expect(pitchName("B", 0, "german")).toBe("H");
    expect(pitchName("B", -1, "english")).toBe("B♭");
    expect(pitchName("B", -1, "german")).toBe("B");
  });

  it("spells german accidentals with is and es", () => {
    expect(pitchName("C", 1, "german")).toBe("Cis");
    expect(pitchName("E", -1, "german")).toBe("Es");
    expect(pitchName("A", -1, "german")).toBe("As");
    expect(pitchName("D", -1, "german")).toBe("Des");
    expect(pitchName("F", 2, "german")).toBe("Fisis");
  });

  it("names solfege syllables", () => {
    expect(pitchName("G", 0, "solfege")).toBe("Sol");
    expect(pitchName("F", 1, "solfege")).toBe("Fa♯");
  });
});

describe("fullName", () => {
  it("writes middle C as C4 and c¹", () => {
    const c4 = spellMidi(60, false);
    expect(fullName(c4, "english")).toBe("C4");
    expect(fullName(c4, "german")).toBe("c¹");
    expect(fullName(c4, "solfege")).toBe("Do4");
  });

  it("uses Helmholtz octaves in german", () => {
    expect(fullName(spellMidi(48, false), "german")).toBe("c");
    expect(fullName(spellMidi(36, false), "german")).toBe("C");
    expect(fullName(spellMidi(24, false), "german")).toBe("C₁");
    expect(fullName(spellMidi(83, false), "german")).toBe("h²");
  });
});

describe("spellMidi", () => {
  it("prefers flats in flat keys", () => {
    expect(spellMidi(61, false)).toEqual({ step: "C", alter: 1, octave: 4 });
    expect(spellMidi(61, true)).toEqual({ step: "D", alter: -1, octave: 4 });
  });
});

describe("keyName", () => {
  it("names keys in the chosen system", () => {
    expect(keyName(0, "major", "english")).toBe("C major");
    expect(keyName(0, "minor", "english")).toBe("A minor");
    expect(keyName(-3, "major", "english")).toBe("E♭ major");
    expect(keyName(-3, "major", "german")).toBe("Es major");
    expect(keyName(5, "major", "german")).toBe("H major");
  });
});
