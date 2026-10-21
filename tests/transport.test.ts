import { describe, expect, it } from "vitest";
import type { Measure } from "../src/core/types";
import { clicksFor, countInAt, countInFor } from "../src/player/transport";

const bar = (over: Partial<Measure>): Measure => ({
  idx: 0,
  label: "1",
  startQ: 0,
  durQ: 4,
  nominal: 4,
  beats: 4,
  beatType: 4,
  beatQ: 1,
  pickup: false,
  fifths: 0,
  mode: "major",
  barEnd: "",
  rehearsal: "",
  change: false,
  kind: "calm",
  repeatStart: false,
  repeatTimes: 0,
  ending: null,
  ...over,
});

describe("clicksFor", () => {
  it("clicks every beat with an accent on one", () => {
    expect(clicksFor(bar({}))).toEqual([
      { t: 0, accent: true },
      { t: 1, accent: false },
      { t: 2, accent: false },
      { t: 3, accent: false },
    ]);
  });

  it("starts a pickup bar on the right beat", () => {
    expect(clicksFor(bar({ pickup: true, durQ: 1 }))).toEqual([{ t: 0, accent: false }]);
  });
});

describe("countInFor", () => {
  it("counts one full bar before a normal start", () => {
    const c = countInFor(bar({}));
    expect(c.map((e) => e.beat)).toEqual([1, 2, 3, 4]);
    expect(c[0].t).toBe(-4);
  });

  it("counts up to the pickup", () => {
    const c = countInFor(bar({ beats: 3, beatType: 8, nominal: 1.5, beatQ: 0.5, pickup: true, durQ: 0.5 }));
    // 3/8 with an eighth pickup: count "1 2", the pickup is beat 3
    expect(c.map((e) => e.beat)).toEqual([1, 2]);
    expect(c.at(-1)!.t).toBe(-0.5);
  });
});

describe("countInAt", () => {
  it("counts the beats right before a pause on a beat, with that bar's numbers", () => {
    const c = countInAt(bar({}), 4, 6); // the bar played from 4, paused on its beat 3
    expect(c.map((e) => e.t)).toEqual([2, 3, 4, 5]);
    expect(c.map((e) => e.beat)).toEqual([3, 4, 1, 2]);
    expect(c.map((e) => e.accent)).toEqual([false, false, true, false]);
    expect(c.every((e) => e.count)).toBe(true);
  });

  it("puts the last click on the beat a pause between beats belongs to", () => {
    const c = countInAt(bar({}), 0, 2.5);
    expect(c.map((e) => e.t)).toEqual([-1, 0, 1, 2]);
    expect(c.map((e) => e.beat)).toEqual([4, 1, 2, 3]);
  });

  it("keeps the beats of a piece with a pickup", () => {
    const eighths = { beats: 3, beatType: 8, nominal: 1.5, beatQ: 0.5 };
    // The bar after an eighth pickup, played from 0.5, paused on its second eighth.
    const c = countInAt(bar({ ...eighths, durQ: 1.5 }), 0.5, 1);
    expect(c.map((e) => e.t)).toEqual([-0.5, 0, 0.5]);
    expect(c.map((e) => e.beat)).toEqual([2, 3, 1]);
  });
});
