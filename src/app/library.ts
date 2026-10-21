import type { FingerOverrides } from "../core/fingering";
import { lsGet, lsSet } from "./settings";

/** A song as the user opened it, kept in IndexedDB so it is there next time. */
export interface SongRecord {
  id: string;
  fileName: string;
  title: string;
  composer: string;
  kind: "musicxml" | "midi";
  /** MusicXML text or MIDI bytes. */
  data: string | ArrayBuffer;
  bars: number;
  openedAt: number;
}

const DB = "quickiano";
const STORE = "songs";
const LAST = "quickiano:last";

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: "id" });
      s.createIndex("openedAt", "openedAt");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Keeps a song; `last` also makes it the one that opens next time. */
export async function saveSong(rec: SongRecord, last = true): Promise<boolean> {
  try {
    await run("readwrite", (s) => s.put(rec));
    if (last) lsSet(LAST, rec.id);
    return true;
  } catch {
    return false;
  }
}

export async function getSong(id: string): Promise<SongRecord | null> {
  try {
    return (await run<SongRecord | undefined>("readonly", (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

export async function recentSongs(limit = 6): Promise<SongRecord[]> {
  try {
    const all = await run<SongRecord[]>("readonly", (s) => s.getAll());
    return all.sort((a, b) => b.openedAt - a.openedAt).slice(0, limit);
  } catch {
    return [];
  }
}

export async function removeSong(id: string): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(id));
    if (lastSongId() === id) lsSet(LAST, null);
  } catch {
    /* nothing to remove */
  }
}

export function lastSongId(): string | null {
  return lsGet<string | null>(LAST, null);
}

export function forgetLast(): void {
  lsSet(LAST, null);
}

export const loadRange = (id: string) => lsGet<[number, number] | null>("quickiano:range:" + id, null);
export const saveRange = (id: string, r: [number, number]) => lsSet("quickiano:range:" + id, r);
export const loadFingers = (id: string) => lsGet<FingerOverrides>("quickiano:fingers:" + id, {}) || {};
export const saveFingers = (id: string, f: FingerOverrides) => lsSet("quickiano:fingers:" + id, f);
