import type { Note, Score } from "./types";

/*
 * Fingering suggestions: dynamic programming over attack slices per hand.
 * Finger-pair spans follow the classic comfort table (semitones, right hand,
 * lower finger first): [minPractical, minComfortable, minRelaxed, maxRelaxed,
 * maxComfortable, maxPractical]. The left hand uses the same table on mirrored
 * pitches.
 */
const SPAN: Record<string, [number, number, number, number, number, number]> = {
  "1-2": [-5, -3, 1, 5, 8, 10],
  "1-3": [-4, -2, 3, 7, 10, 12],
  "1-4": [-3, -1, 5, 9, 12, 14],
  "1-5": [-1, 1, 7, 10, 13, 15],
  "2-3": [1, 1, 1, 2, 3, 5],
  "2-4": [1, 1, 3, 4, 5, 7],
  "2-5": [2, 2, 5, 6, 8, 10],
  "3-4": [1, 1, 1, 2, 2, 4],
  "3-5": [1, 1, 3, 4, 5, 7],
  "4-5": [1, 1, 1, 2, 3, 5],
};

const BLACK = new Set([1, 3, 6, 8, 10]);
export const pitchClass = (m: number) => ((m % 12) + 12) % 12;
export const isBlack = (m: number) => BLACK.has(pitchClass(m));

/** All finger sets of a given size, ascending: COMBOS[2] = [[1,2],[1,3],…]. */
const COMBOS: number[][][] = [[], [], [], [], [], []];
for (let mask = 1; mask < 32; mask++) {
  const fs: number[] = [];
  for (let f = 1; f <= 5; f++) if (mask & (1 << (f - 1))) fs.push(f);
  COMBOS[fs.length].push(fs);
}

function pairCost(h1: number, f1: number, h2: number, f2: number): number {
  const raw = h2 - h1;
  if (f1 === f2) return raw === 0 ? 0 : Math.abs(raw) > 12 ? 4 : 5 + Math.abs(raw) * 0.4;
  let a = f1;
  let b = f2;
  let d = raw;
  if (a > b) {
    a = f2;
    b = f1;
    d = -raw;
  }
  const [minP, minC, minR, maxR, maxC, maxP] = SPAN[a + "-" + b];
  const w = a === 1 ? 1 : 2;
  let c = 0;
  if (d > maxR) c += w * (d - maxR);
  if (d < minR) c += w * (minR - d);
  if (d > maxC) c += 2 * (d - maxC);
  if (d < minC) c += 2 * (minC - d);
  if (d > maxP || d < minP) c += 6;
  // Beyond the practical span the hand has to jump; crossings stay expensive.
  if (d > maxP) c = Math.min(c, 8 + 0.5 * (d - maxP));
  return c;
}

interface Key {
  /** Pitch mirrored for the left hand, so "higher" always means away from the thumb. */
  h: number;
  midi: number;
  notes: Note[];
  fixed: number | null;
}

interface Candidate {
  fs: number[];
  own: number;
  cost: number;
  back: number;
}

interface Slice {
  k: number;
  q: number;
  end: number;
  notes: Note[];
  uniq: Key[];
  cands: Candidate[];
}

function ownCost(uniq: Key[], fs: number[]): number {
  let c = 0;
  uniq.forEach((u, j) => {
    const f = fs[j];
    if (f === 4) c += 1;
    else if (f === 5) c += 0.5;
    if (isBlack(u.midi)) {
      if (f === 1) c += 2;
      else if (f === 5) c += 1;
    }
  });
  for (let j = 0; j + 1 < uniq.length; j++) c += 0.8 * pairCost(uniq[j].h, fs[j], uniq[j + 1].h, fs[j + 1]);
  return c;
}

function transCost(P: Key[], pf: number[], C: Key[], cf: number[]): number {
  const a = P.length - 1;
  const b = C.length - 1;
  let c = pairCost(P[a].h, pf[a], C[b].h, cf[b]);
  if (a > 0 || b > 0) c += pairCost(P[0].h, pf[0], C[0].h, cf[0]);
  const x = pf[a];
  const y = cf[b];
  if ((x === 3 && y === 4) || (x === 4 && y === 3)) c += 1;
  return c;
}

/** hand: 1 for the right hand, -1 for the left (mirrors pitches). */
function fingerStaff(attacks: Note[], hand: 1 | -1): void {
  const groups = new Map<number, Slice>();
  for (const n of attacks) {
    const k = Math.round(n.q * 960) * 16 + (n.grace ? 8 - Math.min(n.graceRank || 1, 7) : 8);
    let g = groups.get(k);
    if (!g) {
      g = { k, q: n.q, end: n.q, notes: [], uniq: [], cands: [] };
      groups.set(k, g);
    }
    g.notes.push(n);
    g.end = Math.max(g.end, n.q + (n.grace ? 0.1 : n.remain));
  }
  const slices = [...groups.values()].sort((a, b) => a.k - b.k);
  for (const sl of slices) {
    const byMidi = new Map<number, Key>();
    for (const n of sl.notes) {
      let u = byMidi.get(n.sound);
      if (!u) {
        u = { h: hand * n.sound, midi: n.sound, notes: [], fixed: null };
        byMidi.set(n.sound, u);
      }
      u.notes.push(n);
      if (n.fixed && !u.fixed) u.fixed = n.fixed;
    }
    let uniq = [...byMidi.values()].sort((a, b) => a.h - b.h);
    if (uniq.length > 5) uniq = uniq.slice(uniq.length - 5);
    sl.uniq = uniq;
    let cands = COMBOS[uniq.length].filter((fs) => uniq.every((u, j) => !u.fixed || u.fixed === fs[j]));
    if (!cands.length) cands = COMBOS[uniq.length];
    sl.cands = cands.map((fs) => ({ fs, own: ownCost(uniq, fs), cost: 0, back: -1 }));
  }
  for (let i = 0; i < slices.length; i++) {
    const sl = slices[i];
    if (i === 0) {
      sl.cands.forEach((c) => {
        c.cost = c.own;
      });
      continue;
    }
    const ps = slices[i - 1];
    const weight = sl.q - ps.end > 0.99 ? 0.25 : 1; // after a rest the hand can move freely
    for (const c of sl.cands) {
      let best = Infinity;
      let bi = 0;
      ps.cands.forEach((p, pi) => {
        const v = p.cost + weight * transCost(ps.uniq, p.fs, sl.uniq, c.fs);
        if (v < best) {
          best = v;
          bi = pi;
        }
      });
      c.cost = best + c.own;
      c.back = bi;
    }
  }
  if (!slices.length) return;
  const last = slices[slices.length - 1].cands;
  let bi = 0;
  last.forEach((c, i) => {
    if (c.cost < last[bi].cost) bi = i;
  });
  for (let i = slices.length - 1; i >= 0; i--) {
    const c = slices[i].cands[bi];
    slices[i].uniq.forEach((u, j) =>
      u.notes.forEach((n) => {
        n.autoFinger = c.fs[j];
      }),
    );
    bi = c.back;
  }
}

export type FingerOverrides = Record<string, number>;

/**
 * Sets `finger` and `fingerSrc` on every note: your own choice wins, then the
 * file's fingering, then the suggestion. Fixed fingers steer the suggestion
 * of the notes around them.
 */
export function computeFingering(score: Score, overrides: FingerOverrides = {}): void {
  for (const n of score.notes) {
    n.fixed = overrides[n.id] || n.fileFinger || null;
    n.autoFinger = null;
  }
  for (const st of [0, 1] as const) {
    fingerStaff(
      score.notes.filter((n) => n.staff === st && !n.cont),
      st === 0 ? 1 : -1,
    );
  }
  for (const n of score.notes) {
    if (n.cont) continue;
    if (overrides[n.id]) {
      n.finger = overrides[n.id];
      n.fingerSrc = "user";
    } else if (n.fileFinger) {
      n.finger = n.fileFinger;
      n.fingerSrc = "file";
    } else {
      n.finger = n.autoFinger;
      n.fingerSrc = "auto";
    }
    for (let c = n.next; c; c = c.next) {
      c.finger = n.finger;
      c.fingerSrc = n.fingerSrc;
    }
  }
}

/** The note that starts the tie chain `n` belongs to. */
export function tieHead(n: Note): Note {
  while (n.prev) n = n.prev;
  return n;
}
