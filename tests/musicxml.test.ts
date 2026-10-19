import { describe, expect, it } from "vitest";
import { parseMusicXML } from "../src/core/musicxml";
import { backup, note, pianoXML, rest } from "./helpers";

describe("parseMusicXML", () => {
  it("reads title, composer, hands and the measure grid", () => {
    const xml = pianoXML(
      '<measure number="1">' +
        note("C4", 4, 1) +
        note("D4", 4, 1) +
        note("E4", 4, 1) +
        note("F4", 4, 1) +
        backup(16) +
        note("C3", 16, 2) +
        "</measure>" +
        '<measure number="2">' +
        note("G4", 16, 1) +
        backup(16) +
        note("G2", 16, 2) +
        "</measure>",
      { title: "Scale" },
    );
    const s = parseMusicXML(xml);
    expect(s.title).toBe("Scale");
    expect(s.composer).toBe("Tester");
    expect(s.measures).toHaveLength(2);
    expect(s.measures[1].startQ).toBe(4);
    expect(s.notes.filter((n) => n.staff === 0).map((n) => n.midi)).toEqual([60, 62, 64, 65, 67]);
    expect(s.notes.filter((n) => n.staff === 1).map((n) => n.midi)).toEqual([48, 43]);
    expect(s.timeLabel).toBe("4/4");
    expect(s.lo).toBe(43);
    expect(s.hi).toBe(67);
  });

  it("detects a pickup bar", () => {
    const xml = pianoXML(
      '<measure number="0" implicit="yes">' +
        note("E5", 2, 1) +
        backup(2) +
        rest(2, 2) +
        "</measure>" +
        '<measure number="1">' +
        note("A4", 6, 1) +
        backup(6) +
        note("A2", 6, 2) +
        "</measure>",
      { time: "3/8" },
    );
    const s = parseMusicXML(xml);
    expect(s.measures[0].pickup).toBe(true);
    expect(s.measures[0].durQ).toBe(0.5);
    expect(s.measures[1].startQ).toBe(0.5);
    expect(s.measures[1].beatQ).toBe(0.5);
  });

  it("joins tied notes into one key press", () => {
    const xml = pianoXML(
      '<measure number="1">' +
        note("C5", 8, 1) +
        note("E5", 8, 1, { tie: "start" }) +
        backup(16) +
        rest(16, 2) +
        "</measure>" +
        '<measure number="2">' +
        note("E5", 8, 1, { tie: "stop" }) +
        note("D5", 8, 1) +
        backup(16) +
        rest(16, 2) +
        "</measure>",
    );
    const s = parseMusicXML(xml);
    const e = s.notes.filter((n) => n.midi === 76);
    expect(e).toHaveLength(2);
    expect(e[0].remain).toBe(4);
    expect(e[0].next).toBe(e[1]);
    expect(e[1].cont).toBe(true);
    expect(e[1].headM).toBe(0);
  });

  it("keeps fingerings from the file and ranks grace notes", () => {
    const xml = pianoXML(
      '<measure number="1">' +
        note("D5", 0, 1, { grace: true }) +
        note("C5", 16, 1, { finger: 3 }) +
        backup(16) +
        rest(16, 2) +
        "</measure>",
    );
    const s = parseMusicXML(xml);
    const grace = s.notes.find((n) => n.grace)!;
    const main = s.notes.find((n) => !n.grace)!;
    expect(grace.graceRank).toBe(1);
    expect(grace.dur).toBe(0);
    expect(main.fileFinger).toBe(3);
  });

  it("applies 8va lines to the sounding pitch", () => {
    const xml = pianoXML(
      '<measure number="1">' +
        '<direction><direction-type><octave-shift type="down" size="8"/></direction-type><staff>1</staff></direction>' +
        note("C5", 16, 1) +
        backup(16) +
        rest(16, 2) +
        "</measure>",
    );
    const s = parseMusicXML(xml);
    expect(s.notes[0].midi).toBe(72);
    expect(s.notes[0].sound).toBe(84);
    expect(s.hasShift).toBe(true);
  });

  it("reads the tempo from a metronome mark", () => {
    const xml = pianoXML(
      '<measure number="1">' +
        "<direction><direction-type><metronome><beat-unit>half</beat-unit><per-minute>40</per-minute></metronome></direction-type><staff>1</staff></direction>" +
        note("C5", 16, 1) +
        backup(16) +
        rest(16, 2) +
        "</measure>",
    );
    expect(parseMusicXML(xml).tempo).toBe(80);
  });

  it("does not take a 'Composed by' line as the title", () => {
    const xml = pianoXML('<measure number="1">' + note("C5", 16, 1) + backup(16) + rest(16, 2) + "</measure>")
      .replace(/<work>.*?<\/work>/, "<movement-title>Composed by Yann Tiersen</movement-title>")
      .replace(/<identification>.*?<\/identification>/, "")
      .replace(
        "<part-list>",
        '<credit page="1"><credit-words font-size="20">Comptine d\u2019un autre été</credit-words></credit>' +
          '<credit page="1"><credit-words font-size="14">Composed by Yann Tiersen</credit-words></credit>' +
          '<credit page="1"><credit-words font-size="7">5</credit-words></credit><part-list>',
      );
    const s = parseMusicXML(xml);
    expect(s.title).toBe("Comptine d\u2019un autre été");
    expect(s.composer).toBe("Yann Tiersen");
  });

  it("rejects files that are not MusicXML", () => {
    expect(() => parseMusicXML("<html></html>")).toThrow(/not a MusicXML score/);
    expect(() => parseMusicXML("garbage <")).toThrow(/not valid MusicXML/);
  });
});
