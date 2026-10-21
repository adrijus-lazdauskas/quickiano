import { describe, expect, it } from "vitest";
import { parseMusicXML } from "../src/core/musicxml";
import { backup, note, octaveShift, pianoXML, rest } from "./helpers";

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
    expect(e[1].prev).toBe(e[0]);
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

  it("reads 8va lines as notation only: the file holds the sounding pitch", () => {
    const xml = pianoXML(
      '<measure number="1">' +
        octaveShift("down") +
        note("C7", 4, 1) +
        octaveShift("continue") +
        note("B6", 4, 1) +
        octaveShift("stop") +
        note("A5", 8, 1) +
        backup(16) +
        octaveShift("up", 2, 15) +
        note("C1", 16, 2) +
        "</measure>",
    );
    const s = parseMusicXML(xml);
    const by = (sound: number) => s.notes.find((n) => n.sound === sound)!;
    // C7 sounds and is drawn as C6 under the line.
    expect(by(96)).toMatchObject({ midi: 84, octave: 6, shift: 12 });
    expect(by(95)).toMatchObject({ midi: 83, shift: 12 });
    expect(by(81)).toMatchObject({ midi: 81, shift: 0 });
    // 15mb: C1 is drawn two octaves up, as C3.
    expect(by(24)).toMatchObject({ midi: 48, octave: 3, shift: -24 });
    expect(s.lo).toBe(24);
    expect(s.hi).toBe(96);
    expect(s.hasShift).toBe(true);
  });

  it("joins a tie that runs out of an 8va line and keeps ids on the sounding pitch", () => {
    const xml = pianoXML(
      '<measure number="1">' +
        octaveShift("down") +
        note("C7", 16, 1, { tie: "start" }) +
        octaveShift("stop") +
        backup(16) +
        rest(16, 2) +
        "</measure>" +
        '<measure number="2">' +
        note("C7", 16, 1, { tie: "stop" }) +
        backup(16) +
        rest(16, 2) +
        "</measure>",
    );
    const [head, tail] = parseMusicXML(xml).notes.filter((n) => n.sound === 96);
    expect(head.midi).toBe(84);
    expect(tail.midi).toBe(96);
    expect(head.next).toBe(tail);
    expect(tail.cont).toBe(true);
    expect(head.id).toBe("0:0:0:96:1");
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
