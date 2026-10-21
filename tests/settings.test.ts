import { beforeEach, describe, expect, it } from "vitest";
import { BPM_MAX, BPM_MIN, DEFAULTS, SettingsStore } from "../src/app/settings";

/** Settings as they come back after a reload with `bpm` saved. */
const reloadedBpm = (bpm: unknown) => {
  localStorage.setItem("quickiano:settings", JSON.stringify({ bpm }));
  return new SettingsStore().get().bpm;
};

describe("SettingsStore", () => {
  beforeEach(() => localStorage.clear());

  it("keeps a fast tempo that the slider allows", () => {
    expect(reloadedBpm(250)).toBe(250);
    expect(reloadedBpm(BPM_MAX)).toBe(BPM_MAX);
  });

  it("clamps tempos out of range and drops ones that aren't numbers", () => {
    expect(reloadedBpm(1000)).toBe(BPM_MAX);
    expect(reloadedBpm(5)).toBe(BPM_MIN);
    expect(reloadedBpm("fast")).toBe(DEFAULTS.bpm);
    expect(reloadedBpm(null)).toBe(DEFAULTS.bpm);
  });
});
