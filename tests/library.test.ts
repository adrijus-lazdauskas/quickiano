import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SongRecord } from "../src/app/library";
import { fakeIndexedDB } from "./fakeIndexedDB";

const song = (id: string, openedAt = 1): SongRecord => ({
  id,
  fileName: id + ".musicxml",
  title: id,
  composer: "",
  kind: "musicxml",
  data: "<score-partwise/>",
  bars: 1,
  openedAt,
});

/** A fresh library module on a fresh fake database. */
async function library(opts: { full?: boolean } = {}) {
  vi.resetModules();
  const fake = fakeIndexedDB(opts);
  vi.stubGlobal("indexedDB", fake.indexedDB);
  return { rows: fake.rows, lib: await import("../src/app/library") };
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("library", () => {
  it("keeps a song and opens it next time", async () => {
    const { lib } = await library();
    expect(await lib.saveSong(song("a"))).toBe(true);
    expect((await lib.getSong("a"))?.title).toBe("a");
    expect(lib.lastSongId()).toBe("a");
  });

  it("says so when the browser could not keep a song", async () => {
    const { lib, rows } = await library({ full: true });
    expect(await lib.saveSong(song("a"))).toBe(false);
    expect(rows.size).toBe(0);
    expect(lib.lastSongId()).toBe(null);
  });
});
