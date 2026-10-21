import { describe, expect, it } from "vitest";
import { tieHead } from "../src/core/fingering";
import { parseMusicXML } from "../src/core/musicxml";
import { passAt, passesFor, playLength, playOrder, strikesFor } from "../src/core/score";
import type { Measure } from "../src/core/types";
import { backup, note, pianoXML, repeatBack, rest, voltaStart, voltaStop } from "./helpers";

/** A piano score from bars of right-hand notes; each bar is 4 quarters long. */
function score(...bars: string[]) {
  return parseMusicXML(
    pianoXML(
      bars.map((b, i) => `<measure number="${i + 1}">${b}${backup(16)}${rest(16, 2)}</measure>`).join(""),
    ),
  );
}

type Marks = Partial<Pick<Measure, "repeatStart" | "repeatTimes" | "ending">>;
/** Plain 4/4 bars with only the marks that steer the play order. */
const bars = (...marks: Marks[]) =>
  marks.map((m) => ({ repeatStart: false, repeatTimes: 0, ending: null, ...m }) as Measure);
const fwd: Marks = { repeatStart: true };
const back = (times = 2): Marks => ({ repeatTimes: times });
const volta = (...n: number[]): Marks => ({ ending: n });

describe("playOrder", () => {
  it("plays a repeat without a start sign from the beginning", () => {
    expect(playOrder(bars({}, {}, back()), 0, 2)).toEqual([0, 1, 2, 0, 1, 2]);
  });

  it("goes back to the forward repeat", () => {
    expect(playOrder(bars({}, fwd, {}, back(), {}), 0, 4)).toEqual([0, 1, 2, 3, 1, 2, 3, 4]);
  });

  it("takes the first ending the first time and the second ending after the repeat", () => {
    expect(playOrder(bars(fwd, {}, { ...volta(1), ...back() }, volta(2), {}), 0, 4)).toEqual([
      0, 1, 2, 0, 1, 3, 4,
    ]);
  });

  it("plays a section as often as the repeat says, with shared endings", () => {
    expect(playOrder(bars({}, { ...volta(1, 2), ...back(3) }, volta(3)), 0, 2)).toEqual([0, 1, 0, 1, 0, 2]);
  });

  it("skips a first ending that has no second one", () => {
    expect(playOrder(bars({}, { ...volta(1), ...back() }, {}), 0, 2)).toEqual([0, 1, 0, 2]);
  });

  it("starts the next section after the endings of the one before", () => {
    const b = bars({}, { ...volta(1), ...back() }, volta(2), {}, { ...volta(1), ...back() }, volta(2));
    expect(playOrder(b, 0, 5)).toEqual([0, 1, 0, 2, 3, 4, 3, 5]);
    expect(playOrder(bars({}, back(), {}, back()), 0, 3)).toEqual([0, 1, 0, 1, 2, 3, 2, 3]);
  });

  it("keeps to the selection", () => {
    const b = bars({}, fwd, {}, {}, back(), {});
    expect(playOrder(b, 2, 5)).toEqual([2, 3, 4, 2, 3, 4, 5]);
    expect(playOrder(b, 0, 2)).toEqual([0, 1, 2]);
  });
});

describe("passesFor", () => {
  it("times the bars as they are played", () => {
    const s = score(note("C4", 16, 1), note("D4", 16, 1) + repeatBack(), note("E4", 16, 1));
    const passes = passesFor(s, 0, 2);
    expect(passes).toEqual([
      { m: 0, at: 0 },
      { m: 1, at: 4 },
      { m: 0, at: 8 },
      { m: 1, at: 12 },
      { m: 2, at: 16 },
    ]);
    expect(playLength(s, passes)).toBe(20);
    expect(passAt(passes, 9).m).toBe(0);
    expect(passAt(passes, 12).m).toBe(1);
    expect(passAt(passes, -1).m).toBe(0);
  });
});

describe("strikesFor", () => {
  /** A whole note C4 tied through bars 1 to 3, then a D4 in bar 4. */
  const tied = () =>
    score(
      note("C4", 16, 1, { tie: "start" }),
      note("C4", 16, 1, { tie: "both" }),
      note("C4", 16, 1, { tie: "stop" }),
      note("D4", 16, 1),
    );
  const strikes = (s: ReturnType<typeof score>, from: number, to: number) =>
    strikesFor(s, passesFor(s, from, to)).map(({ n, t }) => `${n.m}@${t}:${n.remain}`);

  it("strikes a tied note once, from where the selection starts", () => {
    const s = tied();
    expect(strikes(s, 0, 3)).toEqual(["0@0:12", "3@12:4"]);
    expect(strikes(s, 1, 2)).toEqual(["1@0:8"]);
    expect(strikes(s, 2, 3)).toEqual(["2@0:4", "3@4:4"]);
  });

  it("strikes every time through a repeat", () => {
    const s = score(note("C4", 16, 1, { tie: "start" }), note("C4", 16, 1, { tie: "stop" }) + repeatBack());
    expect(strikes(s, 0, 1)).toEqual(["0@0:8", "0@8:8"]);
  });

  it("strikes a tied note in the second ending, whose tie began in the first", () => {
    const s = score(
      note("E4", 16, 1),
      voltaStart("1") + note("D4", 16, 1, { tie: "start" }) + voltaStop("1", true),
      voltaStart("2") + note("D4", 16, 1, { tie: "stop" }) + voltaStop("2"),
    );
    expect(strikes(s, 0, 2)).toEqual(["0@0:4", "1@4:8", "0@8:4", "2@12:4"]);
  });

  it("finds the head of a tie chain", () => {
    const [head, middle, tail] = tied().notes.filter((n) => n.midi === 60);
    expect(tieHead(tail)).toBe(head);
    expect(tieHead(middle)).toBe(head);
    expect(tieHead(head)).toBe(head);
  });
});
