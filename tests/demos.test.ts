// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeFingering } from "../src/core/fingering";
import { parseMusicXML } from "../src/core/musicxml";

const load = (f: string) =>
  parseMusicXML(readFileSync(new URL("../public/demos/" + f, import.meta.url), "utf8"));

describe("demo pieces", () => {
  it("Für Elise has a pickup, 3/8 time and full bars", () => {
    const s = load("fur-elise.musicxml");
    expect(s.title).toBe("Für Elise (opening)");
    expect(s.timeLabel).toBe("3/8");
    expect(s.measures[0].pickup).toBe(true);
    expect(s.measures.slice(1).every((m) => Math.abs(m.durQ - 1.5) < 1e-9)).toBe(true);
    computeFingering(s);
    expect(s.notes.filter((n) => !n.cont).every((n) => n.finger! >= 1 && n.finger! <= 5)).toBe(true);
  });

  it("Ode to Joy has eight full 4/4 bars", () => {
    const s = load("ode-to-joy.musicxml");
    expect(s.measures).toHaveLength(8);
    expect(s.measures.every((m) => m.durQ === 4)).toBe(true);
    expect(s.tempo).toBe(100);
  });
});
