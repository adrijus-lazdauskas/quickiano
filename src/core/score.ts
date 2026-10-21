import { classifyMeasures, computeSections } from "./analysis";
import type { Hand, Measure, Note, RawNote, Score } from "./types";
import { EPS } from "./types";

export type MeasureDraft = Pick<
  Measure,
  | "label"
  | "startQ"
  | "durQ"
  | "beats"
  | "beatType"
  | "pickup"
  | "fifths"
  | "mode"
  | "barEnd"
  | "rehearsal"
  | "change"
  | "repeatStart"
  | "repeatTimes"
  | "ending"
>;

/** Title used when a file names none. */
export const UNTITLED = "Untitled";

/** "La_Valse-dAmelie.pdf" → "La Valse dAmelie": a readable title from a file name. */
export function titleFromFileName(name: string): string {
  const t = name
    .replace(/\.(pdf|mxl|musicxml|xml|mid|midi)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t || UNTITLED;
}

export interface ScoreDraft {
  title: string;
  composer: string;
  source: Score["source"];
  measures: MeasureDraft[];
  notes: RawNote[];
  staffMap: Record<string, Hand>;
  usedParts: number[];
  staffCount: number;
  tempo: number;
}

/**
 * Shared second pass for every importer: measures get their beat grid, notes get
 * stable ids, tie chains and grace ranks, and the score gets sections and range.
 */
export function finalizeScore(d: ScoreDraft): Score {
  const measures: Measure[] = d.measures.map((m, idx) => {
    const nominal = (m.beats * 4) / m.beatType;
    const compound = m.beatType === 8 && m.beats % 3 === 0 && m.beats > 3;
    return { ...m, idx, nominal, beatQ: compound ? 1.5 : 4 / m.beatType, kind: "calm" };
  });

  const notes: Note[] = d.notes.map((r) => ({
    ...r,
    id: "",
    sound: r.midi + r.shift,
    remain: r.dur,
    graceRank: 0,
    cont: false,
    next: null,
    prev: null,
    fixed: null,
    autoFinger: null,
    finger: null,
    fingerSrc: null,
  }));
  notes.sort((a, b) => a.q - b.q || a.order - b.order);

  // Stable ids (used for fingering overrides), with the pitch as the file gives it.
  const seen = new Map<string, number>();
  for (const n of notes) {
    let id =
      n.m +
      ":" +
      n.staff +
      ":" +
      Math.round(n.rel * 960) +
      ":" +
      n.sound +
      ":" +
      n.voice +
      (n.grace ? "g" : "");
    const k = seen.get(id);
    if (k) {
      seen.set(id, k + 1);
      id += "#" + k;
    } else seen.set(id, 1);
    n.id = id;
  }

  // Ties: continuation notes are not struck again; heads carry the full length.
  // Matched by the sounding pitch, so a tie that runs out of an 8va line still joins.
  const tkey = (st: number, midi: number, at: number) => st + "|" + midi + "|" + Math.round(at * 960);
  const stops = new Map<string, Note>();
  for (const n of notes) {
    if (n.tieStop && !n.grace) {
      const k = tkey(n.staff, n.sound, n.q);
      if (!stops.has(k)) stops.set(k, n);
    }
  }
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    n.remain = n.dur;
    if (n.tieStart && !n.grace) {
      const c = stops.get(tkey(n.staff, n.sound, n.q + n.dur));
      if (c && c !== n && !c.cont) {
        c.cont = true;
        c.prev = n;
        n.next = c;
        n.remain = n.dur + c.remain;
      }
    }
  }

  // Grace notes: rank 1 sits right before the main note.
  const graces = new Map<string, Note[]>();
  for (const n of notes) {
    if (!n.grace) continue;
    const k = n.staff + "|" + Math.round(n.q * 960);
    const arr = graces.get(k) ?? [];
    arr.push(n);
    graces.set(k, arr);
  }
  for (const arr of graces.values()) {
    const attacks: Note[][] = [];
    arr
      .sort((a, b) => a.order - b.order)
      .forEach((n) => {
        if (!n.chord || !attacks.length) attacks.push([n]);
        else attacks[attacks.length - 1].push(n);
      });
    attacks.forEach((group, i) =>
      group.forEach((n) => {
        n.graceRank = attacks.length - i;
      }),
    );
  }

  classifyMeasures(measures, notes);

  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notes) {
    lo = Math.min(lo, n.sound);
    hi = Math.max(hi, n.sound);
  }
  const first = measures.find((m) => !m.pickup) ?? measures[0];
  return {
    title: d.title,
    composer: d.composer,
    source: d.source,
    measures,
    notes,
    staffMap: d.staffMap,
    usedParts: d.usedParts,
    staffCount: d.staffCount,
    hasShift: notes.some((n) => n.shift !== 0),
    tempo: d.tempo,
    fifths: measures[0]?.fifths ?? 0,
    mode: measures[0]?.mode ?? "major",
    timeLabel: first ? first.beats + "/" + first.beatType : "4/4",
    sections: computeSections(measures),
    lo: Number.isFinite(lo) ? lo : 60,
    hi: Number.isFinite(hi) ? hi : 72,
  };
}

/** Notes that start a key press: no tied continuations. */
export function attacks(score: Score): Note[] {
  return score.notes.filter((n) => !n.cont);
}

/** One bar as it is played: which bar, and where it starts, in quarters into the selection. */
export interface Pass {
  m: number;
  at: number;
}

/**
 * Bars `from`..`to` in the order they are played: repeats taken and the right volta for each
 * time through. A repeat that starts before the selection goes back to its first bar.
 */
export function playOrder(M: Measure[], from: number, to: number): number[] {
  const order: number[] = [];
  const taken = new Map<number, number>();
  let start = from;
  let time = 1;
  for (let i = from, guard = 0; i <= to && guard < 20000; guard++) {
    const m = M[i];
    // A repeated section begins at a forward repeat, or after the last volta of the one before.
    if (i > start && (m.repeatStart || (!m.ending && M[i - 1].ending))) {
      start = i;
      time = 1;
    }
    if (m.ending && !m.ending.includes(time)) {
      i++;
      continue;
    }
    order.push(i);
    if (m.repeatTimes) {
      const played = taken.get(i) ?? 1;
      if (played < m.repeatTimes) {
        taken.set(i, played + 1);
        time++;
        i = start;
        continue;
      }
      taken.delete(i);
      start = i + 1;
      time = 1;
    }
    i++;
  }
  return order;
}

/** The selected bars as they are played, each with where it starts. */
export function passesFor(score: Score, from: number, to: number): Pass[] {
  let at = 0;
  return playOrder(score.measures, from, to).map((m) => {
    const p = { m, at };
    at += score.measures[m].durQ;
    return p;
  });
}

/** How long the passes take to play, in quarters. */
export function playLength(score: Score, passes: Pass[]): number {
  const last = passes[passes.length - 1];
  return last ? last.at + score.measures[last.m].durQ : 0;
}

/** The pass playing `t` quarters into the selection; the first one before it starts. */
export function passAt(passes: Pass[], t: number): Pass {
  let lo = 0;
  let hi = passes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (passes[mid].at <= t + EPS) lo = mid;
    else hi = mid - 1;
  }
  return passes[lo];
}

/** A note as it is played: `t` quarters into the selection. */
export interface Strike {
  n: Note;
  t: number;
}

/**
 * Key presses as the passes play: every note that starts one, and a tied note whose
 * neighbour before it was not just played, which then sounds for the rest of its tie.
 */
export function strikesFor(score: Score, passes: Pass[]): Strike[] {
  const bars = new Set(passes.map((p) => p.m));
  const byBar = new Map<number, Note[]>();
  for (const n of score.notes) {
    if (!bars.has(n.m)) continue;
    const list = byBar.get(n.m) ?? [];
    list.push(n);
    byBar.set(n.m, list);
  }
  const out: Strike[] = [];
  passes.forEach((p, i) => {
    const before = i > 0 ? passes[i - 1].m : -1;
    for (const n of byBar.get(p.m) ?? []) {
      if (n.cont && (n.prev!.m === n.m || n.prev!.m === before)) continue;
      out.push({ n, t: p.at + n.rel });
    }
  });
  return out;
}

/** End of the measure range in quarter notes. */
export function rangeQ(score: Score, from: number, to: number): { startQ: number; endQ: number } {
  const a = score.measures[from];
  const b = score.measures[to];
  return { startQ: a.startQ, endQ: b.startQ + b.durQ };
}

export const isWithin = (q: number, a: number, b: number) => q >= a - EPS && q < b - EPS;
