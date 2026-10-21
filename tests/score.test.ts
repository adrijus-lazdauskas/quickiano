import { describe, expect, it } from "vitest";
import { tieHead } from "../src/core/fingering";
import { parseMusicXML } from "../src/core/musicxml";
import { strikesIn } from "../src/core/score";
import { backup, note, pianoXML, rest } from "./helpers";

/** A whole note C4 tied through bars 1 to 3, then a D4 in bar 4. */
function tiedThroughThreeBars() {
  const bar = (i: number, notes: string) =>
    `<measure number="${i + 1}">${notes}${backup(16)}${rest(16, 2)}</measure>`;
  return parseMusicXML(
    pianoXML(
      bar(0, note("C4", 16, 1, { tie: "start" })) +
        bar(1, note("C4", 16, 1, { tie: "both" })) +
        bar(2, note("C4", 16, 1, { tie: "stop" })) +
        bar(3, note("D4", 16, 1)),
    ),
  );
}

describe("strikesIn", () => {
  it("strikes a tied note once, from where the selection starts", () => {
    const s = tiedThroughThreeBars();
    const strikes = (from: number, to: number) => strikesIn(s, from, to).map((n) => `${n.m}:${n.remain}`);
    expect(strikes(0, 3)).toEqual(["0:12", "3:4"]);
    expect(strikes(1, 2)).toEqual(["1:8"]);
    expect(strikes(2, 3)).toEqual(["2:4", "3:4"]);
  });

  it("finds the head of a tie chain", () => {
    const [head, middle, tail] = tiedThroughThreeBars().notes.filter((n) => n.midi === 60);
    expect(tieHead(tail)).toBe(head);
    expect(tieHead(middle)).toBe(head);
    expect(tieHead(head)).toBe(head);
  });
});
